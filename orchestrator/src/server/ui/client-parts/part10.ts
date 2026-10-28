export const part10: string = `  function kpWorkerEscape(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function kpWorkerRenderMachines(payload) {
    var machines = Array.isArray(payload)
      ? payload
      : (payload && Array.isArray(payload.machines) ? payload.machines : null);
    if (!machines) {
      return '<div class="run empty"><span class="name muted">工作机列表暂不可用</span></div>';
    }
    if (!machines.length) {
      return '<div class="run empty"><span class="name muted">暂无在线工作机</span></div>';
    }
    return machines.map((machine) => {
      var item = machine && typeof machine === "object" ? machine : new Object();
      var name = kpWorkerEscape(item.machineName) || "未命名工作机";
      var root = kpWorkerEscape(item.root) || "未报告工作目录";
      var machineId = kpWorkerEscape(item.machineId);
      return '<div class="run kp-worker-machine">'
        + '<span class="name">' + name + '</span>'
        + '<code class="kp-worker-root">' + root + '</code>'
        + (machineId ? '<span class="hint">' + machineId + '</span>' : "")
        + (machineId
          ? '<button class="b kp-worker-revoke" data-kp-worker-action="revoke" data-kp-machine="'
            + machineId + '">吊销</button>'
          : "")
        + '</div>';
    }).join("");
  }

  function kpWorkerRenderRevoked(payload) {
    var revoked = Array.isArray(payload)
      ? payload
      : (payload && Array.isArray(payload.revoked) ? payload.revoked : null);
    if (!revoked) {
      return '<div class="run empty"><span class="name muted">已吊销名单暂不可用</span></div>';
    }
    if (!revoked.length) {
      return '<div class="run empty"><span class="name muted">暂无已吊销工作机</span></div>';
    }
    return revoked.map((entry) => {
      var item = entry && typeof entry === "object" ? entry : new Object();
      var machineId = kpWorkerEscape(item.machineId);
      var reason = kpWorkerEscape(item.reason) || "未说明原因";
      return '<div class="run kp-worker-revoked-item">'
        + '<span class="name">' + (machineId || "未知工作机") + '</span>'
        + '<span class="hint">' + reason + '</span>'
        + (machineId
          ? '<button class="b kp-worker-unrevoke" data-kp-worker-action="unrevoke" data-kp-machine="'
            + machineId + '">解除</button>'
          : "")
        + '</div>';
    }).join("");
  }

  function kpWorkerWsUrl(locationValue) {
    var source = locationValue;
    if (!source) {
      try { source = window.location; } catch (_error) { return ""; }
    }
    if (typeof source === "string") {
      try { source = new URL(source); } catch (_error) { return ""; }
    }
    var protocol = source && source.protocol ? String(source.protocol).toLowerCase() : "";
    var host = source && source.host ? String(source.host) : "";
    if (!host && source && source.hostname) {
      host = String(source.hostname) + (source.port ? ":" + String(source.port) : "");
    }
    if (!host) return "";
    if (protocol === "https:") return "wss://" + host + "/api/worker/connect";
    if (protocol === "http:") return "ws://" + host + "/api/worker/connect";
    return "";
  }

  function kpWorkerCommandLine(locationValue) {
    var url = typeof locationValue === "string" && /^wss?:\\/\\//i.test(locationValue)
      ? locationValue
      : kpWorkerWsUrl(locationValue);
    var target = url || "<cockpit-ws-url>";
    return 'KUNPENG_WORKER_TOKEN="<WORKER_TOKEN>" kunpeng worker --url "'
      + target
      + '" --name "<工作机名称>" --root "<工作目录>"';
  }

  function kpWorkerLoadMachines() {
    var box = document.getElementById("kp-worker-machines");
    if (!box) return Promise.resolve();
    box.innerHTML = '<div class="run empty"><span class="name muted">加载中…</span></div>';
    return fetch("/api/worker/machines").then((response) => {
      return response.json().catch(() => null).then((payload) => {
        if (!response.ok) return null;
        return payload;
      });
    }).then((payload) => {
      box.innerHTML = kpWorkerRenderMachines(payload);
    }).catch(() => {
      box.innerHTML = kpWorkerRenderMachines(null);
    });
  }

  function kpWorkerLoadRevoked() {
    var box = document.getElementById("kp-worker-revoked");
    if (!box) return Promise.resolve();
    box.innerHTML = '<div class="run empty"><span class="name muted">加载中…</span></div>';
    return fetch("/api/worker/revoked").then((response) => {
      return response.json().catch(() => null).then((payload) => {
        return { ok: response.ok, payload: payload };
      });
    }).then((result) => {
      if (!result.ok) {
        var message = result.payload && typeof result.payload.error === "string"
          ? result.payload.error
          : "已吊销名单读取失败";
        box.innerHTML = '<div class="run empty"><span class="name muted">'
          + kpWorkerEscape(message) + '</span></div>';
        return;
      }
      box.innerHTML = kpWorkerRenderRevoked(result.payload);
    }).catch(() => {
      box.innerHTML = kpWorkerRenderRevoked(null);
    });
  }

  function kpWorkerShowError(boxId, message) {
    var box = document.getElementById(boxId);
    if (box) {
      box.innerHTML = '<div class="run empty"><span class="name muted">'
        + kpWorkerEscape(message) + '</span></div>';
    }
  }

  function kpWorkerRevoke(machineId) {
    var id = typeof machineId === "string" ? machineId.trim() : "";
    if (!id) return Promise.resolve();
    return fetch("/api/worker/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ machineId: id })
    }).then((response) => {
      return response.json().catch(() => null).then((payload) => {
        return { ok: response.ok, payload: payload };
      });
    }).then((result) => {
      if (!result.ok) {
        var message = result.payload && typeof result.payload.error === "string"
          ? result.payload.error
          : "吊销失败，请稍后重试";
        throw new Error(message);
      }
      return Promise.all([kpWorkerLoadMachines(), kpWorkerLoadRevoked()]);
    }).catch((error) => {
      var message = error && typeof error.message === "string" ? error.message : "吊销失败，请稍后重试";
      kpWorkerShowError("kp-worker-machines", message);
    });
  }

  function kpWorkerUnrevoke(machineId) {
    var id = typeof machineId === "string" ? machineId.trim() : "";
    if (!id) return Promise.resolve();
    return fetch("/api/worker/unrevoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ machineId: id })
    }).then((response) => {
      return response.json().catch(() => null).then((payload) => {
        return { ok: response.ok, payload: payload };
      });
    }).then((result) => {
      if (!result.ok) {
        var message = result.payload && typeof result.payload.error === "string"
          ? result.payload.error
          : "解除失败，请稍后重试";
        throw new Error(message);
      }
      return Promise.all([kpWorkerLoadMachines(), kpWorkerLoadRevoked()]);
    }).catch((error) => {
      var message = error && typeof error.message === "string" ? error.message : "解除失败，请稍后重试";
      kpWorkerShowError("kp-worker-revoked", message);
    });
  }

  function kpWorkerMintToken() {
    var tokenBox = document.getElementById("kp-worker-token");
    if (tokenBox) tokenBox.textContent = "签发中…";
    return fetch("/api/worker/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(new Object())
    }).then((response) => {
      return response.json().catch(() => null).then((payload) => {
        return { ok: response.ok, payload: payload };
      });
    }).then((result) => {
      var token = result.ok && result.payload && typeof result.payload.token === "string"
        ? result.payload.token
        : "";
      if (tokenBox) tokenBox.textContent = token || "签发失败，请稍后重试";
      if (token) toast("工作机 token 已签发");
    }).catch(() => {
      if (tokenBox) tokenBox.textContent = "签发失败，请稍后重试";
    });
  }

  function kpWorkerCopyCommand() {
    var commandBox = document.getElementById("kp-worker-cmd");
    var command = commandBox && commandBox.textContent ? String(commandBox.textContent) : "";
    if (!command) return Promise.resolve();
    if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      toast("浏览器不支持自动复制，请手动复制命令");
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(command).then(() => {
      toast("接入命令已复制");
    }).catch(() => {
      toast("复制失败，请手动复制命令");
    });
  }

  function kpWorkerInit() {
    if (typeof document === "undefined") return;
    var commandBox = document.getElementById("kp-worker-cmd");
    var command = kpWorkerCommandLine();
    if (commandBox && commandBox.textContent !== command) commandBox.textContent = command;

    var machinesBox = document.getElementById("kp-worker-machines");
    if (machinesBox && machinesBox.getAttribute("data-kp-worker-loaded") !== "1") {
      machinesBox.setAttribute("data-kp-worker-loaded", "1");
      kpWorkerLoadMachines();
    }

    var revokedBox = document.getElementById("kp-worker-revoked");
    if (revokedBox && revokedBox.getAttribute("data-kp-worker-loaded") !== "1") {
      revokedBox.setAttribute("data-kp-worker-loaded", "1");
      kpWorkerLoadRevoked();
    }

    if (!kpWorkerInit.eventsBound && typeof document.addEventListener === "function") {
      kpWorkerInit.eventsBound = true;
      document.addEventListener("click", (event) => {
        var target = event && event.target;
        var control = target && target.closest ? target.closest("[data-kp-worker-action]") : null;
        if (!control) return;
        var action = control.getAttribute("data-kp-worker-action") || "";
        if (action !== "mint" && action !== "refresh" && action !== "copy-command"
          && action !== "revoke" && action !== "unrevoke") return;
        event.preventDefault();
        if (action === "mint") kpWorkerMintToken();
        if (action === "refresh") kpWorkerLoadMachines();
        if (action === "copy-command") kpWorkerCopyCommand();
        if (action === "revoke") kpWorkerRevoke(control.getAttribute("data-kp-machine") || "");
        if (action === "unrevoke") kpWorkerUnrevoke(control.getAttribute("data-kp-machine") || "");
      });
    }

    if (!kpWorkerInit.observer && typeof MutationObserver !== "undefined") {
      kpWorkerInit.observer = new MutationObserver(() => {
        if (document.getElementById("kp-worker-machines") || document.getElementById("kp-worker-revoked")) kpWorkerInit();
      });
      var root = document.body || document.documentElement;
      if (root) kpWorkerInit.observer.observe(root, { childList: true, subtree: true });
    }
  }

  kpWorkerInit();

`;
