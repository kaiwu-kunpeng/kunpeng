import { describe, expect, it } from 'vitest';
import { renderCrontabLine, renderLaunchdPlist } from '../src/loop/schedule.js';

describe('renderLaunchdPlist', () => {
  const opts = {
    label: 'com.kunpeng.patrol',
    binPath: '/usr/local/bin/node',
    args: ['dist/cli.js', 'patrol'],
    intervalSeconds: 3600,
    workingDir: '/Users/kunpeng/project',
  };

  it('包含 Label / ProgramArguments / StartInterval / WorkingDirectory 关键字段', () => {
    const xml = renderLaunchdPlist(opts);
    expect(xml).toContain('<key>Label</key><string>com.kunpeng.patrol</string>');
    expect(xml).toContain('<key>ProgramArguments</key>');
    expect(xml).toContain('<key>StartInterval</key><integer>3600</integer>');
    expect(xml).toContain('<key>WorkingDirectory</key><string>/Users/kunpeng/project</string>');
  });

  it('ProgramArguments 首项为 binPath，其后依次为每个 args 项', () => {
    const xml = renderLaunchdPlist(opts);
    const idxBin = xml.indexOf('<string>/usr/local/bin/node</string>');
    const idxArg0 = xml.indexOf('<string>dist/cli.js</string>');
    const idxArg1 = xml.indexOf('<string>patrol</string>');
    expect(idxBin).toBeGreaterThanOrEqual(0);
    expect(idxArg0).toBeGreaterThan(idxBin);
    expect(idxArg1).toBeGreaterThan(idxArg0);
  });

  it('输出文本同时包含 label / dist/cli.js / patrol / <integer>3600</integer> / workingDir', () => {
    const xml = renderLaunchdPlist(opts);
    expect(xml).toContain('com.kunpeng.patrol');
    expect(xml).toContain('dist/cli.js');
    expect(xml).toContain('patrol');
    expect(xml).toContain('<integer>3600</integer>');
    expect(xml).toContain('/Users/kunpeng/project');
  });

  it('纯函数：相同入参恒返回相同字符串', () => {
    expect(renderLaunchdPlist(opts)).toBe(renderLaunchdPlist(opts));
  });

  it('给 env 时渲染 EnvironmentVariables dict（含 KUNPENG_BACKEND/PATH/HOME）', () => {
    const xml = renderLaunchdPlist({
      ...opts,
      env: { KUNPENG_BACKEND: 'codex', PATH: '/Users/x/.local/bin:/usr/local/bin', HOME: '/Users/x' },
    });
    expect(xml).toContain('<key>EnvironmentVariables</key>');
    expect(xml).toContain('<key>KUNPENG_BACKEND</key><string>codex</string>');
    expect(xml).toContain('<key>PATH</key><string>/Users/x/.local/bin:/usr/local/bin</string>');
    expect(xml).toContain('<key>HOME</key><string>/Users/x</string>');
  });

  it('不给 env 时不渲染 EnvironmentVariables（向后兼容）', () => {
    expect(renderLaunchdPlist(opts)).not.toContain('EnvironmentVariables');
  });
});

describe('renderCrontabLine', () => {
  it('严格等于 `*/30 * * * * <command>`', () => {
    const command = '/usr/local/bin/node dist/cli.js patrol';
    expect(renderCrontabLine({ intervalMinutes: 30, command })).toBe(
      `*/30 * * * * ${command}`,
    );
  });

  it('纯函数：相同入参恒返回相同字符串', () => {
    const opts = { intervalMinutes: 15, command: 'echo hi' };
    expect(renderCrontabLine(opts)).toBe(renderCrontabLine(opts));
  });
});
