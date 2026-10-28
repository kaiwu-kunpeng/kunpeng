"use strict";

const { readFileSync } = require("node:fs");

const SENSITIVE_FILE_PATTERNS = [
  /auth\.json/i,
  /\.env(?:\b|$)/i,
  /id_rsa\b/i,
  /id_ed25519\b/i,
  /\.ssh(?:[/\\]|$)/i,
  /credentials/i,
  /\.aws(?:[/\\]|\b|$)/i,
];

const NETWORK_TARGET_RULES = [
  { tools: ["*"], strategy: "scheme-url" },
  { tools: ["*"], strategy: "user-at-host" },
  { tools: ["scp", "rsync"], strategy: "remote-spec" },
  { tools: ["nc", "ncat", "netcat", "telnet"], strategy: "host-before-port" },
  {
    tools: ["curl"],
    strategy: "url-positionals",
    booleanShortOptions: "sSfLIikvqNOGR0",
    booleanLongOptions: [
      "--silent", "--show-error", "--fail", "--fail-with-body", "--location", "--head", "--include",
      "--insecure", "--verbose", "--remote-name", "--remote-header-name", "--no-buffer", "--compressed", "--get",
    ],
  },
  {
    tools: ["wget"],
    strategy: "url-positionals",
    booleanShortOptions: "qcv",
    booleanLongOptions: ["--quiet", "--continue", "--spider", "--no-check-certificate"],
  },
  {
    tools: ["ssh"],
    strategy: "first-positional",
    booleanShortOptions: "46AaCfGgKkMNnqsTtVvXxYy",
  },
];

// Executable names included here can send local file contents off the machine.
const EXFILTRATION_ACTION_COMMANDS = [
  "curl", "wget", "nc", "ncat", "netcat", "post", "scp", "rsync",
  "sftp", "ftp", "telnet", "ssh", "gh", "gsutil", "rclone", "croc", "mail", "sendmail",
];

const IDENTITY_OPTION_NAMES = {
  sshFamily: ["-i", "--identity", "--identity-file", "-F"],
  sshConfig: ["IdentityFile", "CertificateFile", "UserKnownHostsFile", "GlobalKnownHostsFile"],
  curl: ["--cert", "-E", "--key", "--cacert", "--capath"],
  wget: ["--ca-certificate", "--certificate"],
  rsync: ["-e", "--rsh"],
  shared: ["--private-key"],
};

const EXFILTRATION_ACTION_OPTION_PATTERNS = [
  /(?:^|\s)-d(?:\s+|=)?@/i,
  /(?:^|\s)--data-binary(?:=|\s+)@/i,
  /(?:^|\s)--post-file(?:=|\s+)\S+/i,
];

const KNOWN_EXFILTRATION_DOMAIN_PATTERNS = [
  /web[h]ook\.site/i,
  /tinyurl/i,
  /pastebin/i,
  /requestbin/i,
  /oast\./i,
  /burpcollaborator/i,
  /ngrok/i,
  /interact\.sh/i,
];

const DOWNLOAD_COMMANDS = ["curl", "wget"];
const STDIN_INTERPRETERS = ["bash", "sh", "zsh", "dash", "ksh", "python", "python2", "python3", "node", "nodejs", "perl", "ruby", "php"];
const SHELL_INTERPRETERS = ["bash", "sh", "zsh", "dash", "ksh"];
// 代码来自参数而不是 stdin/文件：python -c/-m、node -e/-p、perl -e、ruby -e、sh -c
const INTERPRETER_INLINE_CODE_OPTIONS = ["-c", "-e", "-p", "-m", "--eval", "--print"];
// 带值但与脚本来源无关的选项，跳过其值
const INTERPRETER_VALUE_OPTIONS = ["-W", "-X", "-r", "--require", "--import", "-I", "-M", "-o", "-O", "--rcfile", "--init-file", "-l", "--loader"];
const COMMAND_PREFIX_WORDS = ["do", "then", "else", "{", "(", "!", "time", "nohup", "exec", "command", "builtin"];
// 下载内容经替换直接喂给解释器：bash <(curl …)、sh -c "$(curl …)"、eval "$(curl …)"
const DOWNLOAD_SUBSTITUTION_EXECUTE_PATTERNS = [
  /\b(?:bash|sh|zsh|dash|ksh|python3?|python2|node|perl|ruby|php)\b[^|;&\r\n]*<\(\s*(?:curl|wget)\b/i,
  /\b(?:eval|source|exec)\s+["']?(?:\$\(|`)\s*(?:curl|wget)\b/i,
  /\b(?:bash|sh|zsh|dash|ksh)\b(?:\s+-[A-Za-z]+)*\s+-c\s+["']?(?:\$\(|`)\s*(?:curl|wget)\b/i,
  /\b(?:python3?|python2|node|perl|ruby|php)\b(?:\s+-[A-Za-z]+)*\s+-(?:c|e|r)\s+["']?(?:\$\(|`)\s*(?:curl|wget)\b/i,
];

const REVERSE_SHELL_PATTERNS = [
  new RegExp("/dev/tcp/", "i"),
  /\b(?:nc|ncat|netcat)\b[^\r\n]*\s-[A-Za-z]*e\b/i,
  /\bmkfifo\b[\s\S]*?\|[\s\S]*?\b(?:sh|bash)\b/i,
];

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function tokenizeShellCommand(text) {
  const tokens = [];
  let token = "";
  let quote = "";

  const pushToken = () => {
    if (token.length > 0) tokens.push(token);
    token = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quote.length > 0) {
      token += char;
      if (char === quote && text[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      token += char;
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      continue;
    }
    if (char === "|" || char === ";" || char === "&") {
      pushToken();
      const next = text[index + 1] ?? "";
      if (next === char && char !== ";") {
        tokens.push(char + next);
        index += 1;
      } else {
        tokens.push(char);
      }
      continue;
    }
    token += char;
  }
  pushToken();
  return tokens;
}

function normalizeShellToken(token) {
  return token.replace(/^[('"`]+|[)'"`,]+$/g, "");
}

function shellCommandTokenIndexes(tokens) {
  const indexes = new Set();
  let segmentStart = 0;

  while (segmentStart < tokens.length) {
    let segmentEnd = segmentStart;
    while (segmentEnd < tokens.length && !["|", "||", "&&", ";", "&"].includes(tokens[segmentEnd] ?? "")) {
      segmentEnd += 1;
    }

    let index = segmentStart;
    while (index < segmentEnd) {
      const candidate = normalizeShellToken(tokens[index] ?? "");
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(candidate)) {
        index += 1;
        continue;
      }

      const executable = candidate.split("/").pop()?.toLowerCase() ?? "";
      if (executable === "sudo") {
        index += 1;
        while (index < segmentEnd) {
          const option = normalizeShellToken(tokens[index] ?? "");
          if (option === "--") {
            index += 1;
            break;
          }
          if (!option.startsWith("-")) break;
          const needsValue = /^(?:-[ughprCtDTU]|--(?:user|group|host|prompt|role|type|chdir|login-class|other-user))$/.test(option);
          index += needsValue ? 2 : 1;
        }
        continue;
      }

      if (executable === "env") {
        index += 1;
        while (index < segmentEnd) {
          const option = normalizeShellToken(tokens[index] ?? "");
          if (option === "--") {
            index += 1;
            break;
          }
          if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(option)) {
            index += 1;
            continue;
          }
          if (!option.startsWith("-")) break;
          const needsValue = /^(?:-[uCS]|--(?:unset|chdir|split-string))$/.test(option);
          index += needsValue ? 2 : 1;
        }
        continue;
      }

      if (candidate.length > 0) indexes.add(index);
      break;
    }

    segmentStart = segmentEnd + 1;
  }

  return indexes;
}

function containsExfiltrationAction(text) {
  const tokens = tokenizeShellCommand(text);
  const hasActionCommand = [...shellCommandTokenIndexes(tokens)].some((index) => {
    const executable = normalizeShellToken(tokens[index] ?? "").split("/").pop()?.toLowerCase() ?? "";
    return EXFILTRATION_ACTION_COMMANDS.includes(executable);
  });
  return hasActionCommand || matchesAny(text, EXFILTRATION_ACTION_OPTION_PATTERNS);
}

function identityArgumentTokenIndexes(tokens) {
  const identities = new Set();

  for (const commandIndex of shellCommandTokenIndexes(tokens)) {
    const tool = normalizeShellToken(tokens[commandIndex] ?? "").split("/").pop()?.toLowerCase() ?? "";
    const isSshFamily = ["ssh", "scp", "sftp"].includes(tool);
    const optionNames = [
      ...(EXFILTRATION_ACTION_COMMANDS.includes(tool) ? IDENTITY_OPTION_NAMES.shared : []),
      ...(tool === "curl" ? IDENTITY_OPTION_NAMES.curl : []),
      ...(tool === "wget" ? IDENTITY_OPTION_NAMES.wget : []),
      ...(tool === "rsync" ? IDENTITY_OPTION_NAMES.rsync : []),
      ...(isSshFamily ? IDENTITY_OPTION_NAMES.sshFamily : []),
    ];
    if (optionNames.length === 0) continue;

    let segmentEnd = commandIndex + 1;
    while (segmentEnd < tokens.length && !["|", "||", "&&", ";", "&"].includes(tokens[segmentEnd] ?? "")) {
      segmentEnd += 1;
    }

    for (let index = commandIndex + 1; index < segmentEnd; index += 1) {
      const candidate = normalizeShellToken(tokens[index] ?? "");
      if (isSshFamily && (candidate === "-o" || candidate.startsWith("-o"))) {
        const configIndex = candidate === "-o" ? index + 1 : index;
        const configCandidate = candidate === "-o"
          ? normalizeShellToken(tokens[configIndex] ?? "")
          : candidate.slice(2);
        const configEqualsIndex = configCandidate.indexOf("=");
        const configName = configEqualsIndex >= 0
          ? configCandidate.slice(0, configEqualsIndex)
          : configCandidate;
        const isFileConfig = IDENTITY_OPTION_NAMES.sshConfig.some(
          (name) => name.toLowerCase() === configName.toLowerCase(),
        );
        if (isFileConfig) {
          if (configEqualsIndex >= 0) identities.add(configIndex);
          else if (configIndex + 1 < segmentEnd) identities.add(configIndex + 1);
          index = configEqualsIndex >= 0 ? configIndex : configIndex + 1;
          continue;
        }
      }

      const equalsIndex = candidate.indexOf("=");
      let optionName = equalsIndex >= 0 ? candidate.slice(0, equalsIndex) : candidate;
      const attachedShortOption = optionNames.find(
        (name) => name.length === 2 && optionName.startsWith(name) && optionName.length > 2,
      );
      if (attachedShortOption !== undefined) optionName = attachedShortOption;
      if (!optionNames.includes(optionName)) continue;

      const hasAttachedValue = equalsIndex >= 0 || (optionName.length === 2 && candidate.length > 2);
      if (hasAttachedValue) identities.add(index);
      else if (index + 1 < segmentEnd) {
        identities.add(index + 1);
        index += 1;
      }
    }
  }

  return identities;
}

function positionalTokenIndexes(tokens, toolIndex, segmentEnd, rule) {
  const indexes = [];
  let optionParsing = true;
  let optionValuePending = false;

  for (let index = toolIndex + 1; index < segmentEnd; index += 1) {
    const candidate = normalizeShellToken(tokens[index] ?? "");
    if (candidate.length === 0) continue;
    if (optionValuePending) {
      optionValuePending = false;
      continue;
    }
    if (optionParsing && candidate === "--") {
      optionParsing = false;
      continue;
    }
    if (optionParsing && candidate.startsWith("--")) {
      if (!candidate.includes("=") && !rule.booleanLongOptions?.includes(candidate)) optionValuePending = true;
      continue;
    }
    if (optionParsing && /^-[^-]/.test(candidate)) {
      const optionBody = candidate.slice(1);
      const allBoolean = [...optionBody].every((char) => rule.booleanShortOptions?.includes(char));
      if (!allBoolean && optionBody.length === 1) optionValuePending = true;
      continue;
    }
    indexes.push(index);
  }
  return indexes;
}

function networkTargetTokenIndexes(tokens) {
  const targets = new Set();
  const universalRules = NETWORK_TARGET_RULES.filter((rule) => rule.tools.includes("*"));

  for (let index = 0; index < tokens.length; index += 1) {
    const candidate = normalizeShellToken(tokens[index] ?? "");
    for (const rule of universalRules) {
      if (rule.strategy === "scheme-url" && /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(candidate)) targets.add(index);
      if (rule.strategy === "user-at-host" && /^[^@\s/:=]+@[^\s/:=]+(?::\d+)?\/?$/.test(candidate)) targets.add(index);
    }
  }

  let segmentStart = 0;
  while (segmentStart < tokens.length) {
    let segmentEnd = segmentStart;
    while (segmentEnd < tokens.length && !["|", "||", "&&", ";", "&"].includes(tokens[segmentEnd] ?? "")) {
      segmentEnd += 1;
    }

    let toolIndex = -1;
    let tool = "";
    for (let index = segmentStart; index < segmentEnd; index += 1) {
      const executable = normalizeShellToken(tokens[index] ?? "").split("/").pop()?.toLowerCase() ?? "";
      if (NETWORK_TARGET_RULES.some((rule) => rule.tools.includes(executable))) {
        toolIndex = index;
        tool = executable;
        break;
      }
    }

    if (toolIndex >= 0) {
      for (const rule of NETWORK_TARGET_RULES.filter((entry) => entry.tools.includes(tool))) {
        if (rule.strategy === "remote-spec") {
          for (let index = toolIndex + 1; index < segmentEnd; index += 1) {
            const candidate = normalizeShellToken(tokens[index] ?? "");
            if (/^(?:[^@\s/:]+@)?[^\s/:]+:(?!\/\/).*$/i.test(candidate)) targets.add(index);
          }
        }
        if (rule.strategy === "host-before-port") {
          for (let index = toolIndex + 1; index + 1 < segmentEnd; index += 1) {
            const candidate = normalizeShellToken(tokens[index] ?? "");
            const following = normalizeShellToken(tokens[index + 1] ?? "");
            if (!candidate.startsWith("-") && /^\d+$/.test(following)) targets.add(index);
          }
        }
        if (rule.strategy === "url-positionals" || rule.strategy === "first-positional") {
          const positionals = positionalTokenIndexes(tokens, toolIndex, segmentEnd, rule);
          const selected = rule.strategy === "first-positional" ? positionals.slice(0, 1) : positionals;
          for (const index of selected) targets.add(index);
        }
      }
    }

    segmentStart = segmentEnd + 1;
  }
  return targets;
}

function containsSensitiveFileReference(text) {
  const isSensitive = (value) => matchesAny(value, SENSITIVE_FILE_PATTERNS);
  const tokens = tokenizeShellCommand(text);
  const networkTargets = networkTargetTokenIndexes(tokens);
  const identityArguments = identityArgumentTokenIndexes(tokens);

  return tokens.some((token, index) => {
    if (identityArguments.has(index)) return false;
    const substitutions = [
      ...token.matchAll(/\$\(([^)]*)\)/g),
      ...token.matchAll(/`([^`]*)`/g),
    ];
    if (substitutions.some((match) => isSensitive(match[1] ?? ""))) return true;

    const withoutSubstitutions = token.replace(/\$\([^)]*\)|`[^`]*`/g, "");
    const candidate = normalizeShellToken(withoutSubstitutions);
    return !networkTargets.has(index) && isSensitive(candidate);
  });
}

function tokenizeShellLines(text) {
  // 与 tokenizeShellCommand 相同，但换行视作命令分隔符（"上一行下载、下一行执行"也要看到）。
  const tokens = [];
  let token = "";
  let quote = "";
  const pushToken = () => {
    if (token.length > 0) tokens.push(token);
    token = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quote.length > 0) {
      token += char;
      if (char === quote && text[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      token += char;
      continue;
    }
    if (char === "\n") {
      pushToken();
      tokens.push(";");
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      continue;
    }
    if (char === "|" || char === ";" || char === "&") {
      pushToken();
      const next = text[index + 1] ?? "";
      if (next === char && char !== ";") {
        tokens.push(char + next);
        index += 1;
      } else {
        tokens.push(char);
      }
      continue;
    }
    token += char;
  }
  pushToken();
  return tokens;
}

function splitShellSegments(tokens) {
  const segments = [];
  let current = { separator: "", tokens: [] };
  for (const token of tokens) {
    if (["|", "||", "&&", ";", "&"].includes(token)) {
      segments.push(current);
      current = { separator: token, tokens: [] };
      continue;
    }
    current.tokens.push(token);
  }
  segments.push(current);
  return segments.filter((segment) => segment.tokens.length > 0);
}

function segmentCommandIndex(tokens) {
  let index = 0;
  while (index < tokens.length) {
    const candidate = normalizeShellToken(tokens[index] ?? "");
    if (candidate.length === 0 || /^[A-Za-z_][A-Za-z0-9_]*=/.test(candidate) || COMMAND_PREFIX_WORDS.includes(candidate)) {
      index += 1;
      continue;
    }
    const executable = candidate.split("/").pop()?.toLowerCase() ?? "";
    if (executable === "sudo" || executable === "env") {
      index += 1;
      while (index < tokens.length) {
        const option = normalizeShellToken(tokens[index] ?? "");
        if (option === "--") {
          index += 1;
          break;
        }
        if (executable === "env" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(option)) {
          index += 1;
          continue;
        }
        if (!option.startsWith("-")) break;
        const needsValue = executable === "sudo"
          ? /^(?:-[ughprCtDTU]|--(?:user|group|host|prompt|role|type|chdir|login-class|other-user))$/.test(option)
          : /^(?:-[uCS]|--(?:unset|chdir|split-string))$/.test(option);
        index += needsValue ? 2 : 1;
      }
      continue;
    }
    return index;
  }
  return -1;
}

function segmentExecutable(tokens) {
  const index = segmentCommandIndex(tokens);
  if (index < 0) return { index, token: "", executable: "" };
  const token = normalizeShellToken(tokens[index] ?? "");
  return { index, token, executable: token.split("/").pop()?.toLowerCase() ?? "" };
}

function interpreterInvocation(tokens) {
  const command = segmentExecutable(tokens);
  if (!STDIN_INTERPRETERS.includes(command.executable)) return null;
  const positionals = [];
  let optionParsing = true;
  let pendingValue = false;
  let inlineCode = false;
  let stdinFlag = false;
  for (let index = command.index + 1; index < tokens.length; index += 1) {
    const candidate = normalizeShellToken(tokens[index] ?? "");
    if (candidate.length === 0) continue;
    if (pendingValue) {
      pendingValue = false;
      continue;
    }
    if (optionParsing && candidate === "--") {
      optionParsing = false;
      continue;
    }
    if (optionParsing && candidate === "-") {
      positionals.push("-");
      continue;
    }
    if (optionParsing && candidate.startsWith("-")) {
      const equalsIndex = candidate.indexOf("=");
      const name = equalsIndex >= 0 ? candidate.slice(0, equalsIndex) : candidate;
      const shortName = !name.startsWith("--") && name.length > 2 ? name.slice(0, 2) : name;
      if (INTERPRETER_INLINE_CODE_OPTIONS.includes(name)) {
        inlineCode = true;
        if (equalsIndex < 0) pendingValue = true;
        continue;
      }
      if (INTERPRETER_INLINE_CODE_OPTIONS.includes(shortName)) {
        inlineCode = true;
        continue;
      }
      if (INTERPRETER_VALUE_OPTIONS.includes(name)) {
        if (equalsIndex < 0) pendingValue = true;
        continue;
      }
      if (INTERPRETER_VALUE_OPTIONS.includes(shortName)) continue;
      if (SHELL_INTERPRETERS.includes(command.executable) && /^-[A-Za-z]*s[A-Za-z]*$/.test(candidate)) stdinFlag = true;
      continue;
    }
    positionals.push(candidate);
  }
  const readsStdin = !inlineCode && (stdinFlag || positionals.length === 0 || positionals[0] === "-");
  return { executable: command.executable, positionals, inlineCode, readsStdin };
}

function downloadedFileNames(tokens) {
  const command = segmentExecutable(tokens);
  if (!DOWNLOAD_COMMANDS.includes(command.executable)) return [];
  const names = [];
  let remoteName = false;
  let firstUrl = "";
  for (let index = command.index + 1; index < tokens.length; index += 1) {
    const candidate = normalizeShellToken(tokens[index] ?? "");
    if (candidate.length === 0) continue;
    if (firstUrl === "" && /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(candidate)) firstUrl = candidate;
    if (candidate === "-o" || candidate === "--output" || (command.executable === "wget" && (candidate === "-O" || candidate === "--output-document"))) {
      names.push(normalizeShellToken(tokens[index + 1] ?? ""));
      index += 1;
      continue;
    }
    if (candidate.startsWith("--output=") || candidate.startsWith("--output-document=")) {
      names.push(candidate.slice(candidate.indexOf("=") + 1));
      continue;
    }
    if (/^-o./.test(candidate) || (command.executable === "wget" && /^-O./.test(candidate))) {
      names.push(candidate.slice(2));
      continue;
    }
    if (command.executable === "curl" && (candidate === "-O" || candidate === "--remote-name" || /^-[A-Za-z]*O[A-Za-z]*$/.test(candidate))) remoteName = true;
  }
  if (remoteName && firstUrl !== "") {
    const path = firstUrl.replace(/[?#].*$/, "");
    const base = path.split("/").pop() ?? "";
    if (base.length > 0) names.push(base);
  }
  return names.filter((name) => name.length > 0 && name !== "-" && name !== "/dev/null");
}

function downloadPipedToInterpreter(text) {
  let chainHasDownload = false;
  for (const segment of splitShellSegments(tokenizeShellLines(text))) {
    if (segment.separator !== "|") chainHasDownload = false;
    const command = segmentExecutable(segment.tokens);
    if (DOWNLOAD_COMMANDS.includes(command.executable)) {
      chainHasDownload = true;
      continue;
    }
    if (!chainHasDownload) continue;
    const invocation = interpreterInvocation(segment.tokens);
    if (invocation !== null && invocation.readsStdin) return true;
  }
  return false;
}

function downloadedFileExecuted(text) {
  const names = [];
  const matches = (candidate) => names.some((name) =>
    candidate === name || candidate === `./${name}` || `./${candidate}` === name);
  for (const segment of splitShellSegments(tokenizeShellLines(text))) {
    const command = segmentExecutable(segment.tokens);
    if (names.length > 0 && command.index >= 0) {
      if (matches(command.token)) return true;
      const rest = segment.tokens.slice(command.index + 1).map((token) => normalizeShellToken(token)).filter((token) => token.length > 0);
      if ((command.executable === "source" || command.token === ".") && rest.length > 0 && matches(rest[0] ?? "")) return true;
      if (segment.tokens.some((token) => names.some((name) => token.includes(`$(cat ${name}`) || token.includes(`\`cat ${name}`)))) return true;
      const invocation = interpreterInvocation(segment.tokens);
      if (invocation !== null && !invocation.inlineCode && invocation.positionals.length > 0 && matches(invocation.positionals[0] ?? "")) return true;
    }
    if (DOWNLOAD_COMMANDS.includes(command.executable)) names.push(...downloadedFileNames(segment.tokens));
  }
  return false;
}

function downloadAndExecute(text) {
  return downloadPipedToInterpreter(text)
    || matchesAny(text, DOWNLOAD_SUBSTITUTION_EXECUTE_PATTERNS)
    || downloadedFileExecuted(text);
}

function classifyDangerousCommand(cmd) {
  const containsSensitiveFile = containsSensitiveFileReference(cmd);
  const hasExfiltrationAction = containsExfiltrationAction(cmd);

  if (containsSensitiveFile && hasExfiltrationAction) {
    return { block: true, reason: "sensitive-file-exfiltration" };
  }

  if (downloadAndExecute(cmd)) {
    return { block: true, reason: "download-and-execute" };
  }

  if (matchesAny(cmd, REVERSE_SHELL_PATTERNS)) {
    return { block: true, reason: "reverse-shell" };
  }

  if (hasExfiltrationAction && matchesAny(cmd, KNOWN_EXFILTRATION_DOMAIN_PATTERNS)) {
    return { block: true, reason: "known-exfiltration-domain" };
  }

  return { block: false, reason: null };
}

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) process.exit(0);
  if (payload.tool_name !== "Bash") process.exit(0);

  const command = payload.tool_input?.command;
  if (typeof command !== "string" || command.trim().length === 0) process.exit(0);

  const classification = classifyDangerousCommand(command);
  if (!classification.block) process.exit(0);

  process.stderr.write(`[bash-shield] 危险命令被拦截: ${classification.reason}\n`);
  process.exit(2);
} catch {
  // Hook 自身故障不得卡死开发循环。
  process.exit(0);
}