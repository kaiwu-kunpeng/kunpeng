export const part09: string = `  function kpModeAccount() {
    var modeControl = document.querySelector(".kp-mode");
    if (!modeControl) return "default";
    var account = modeControl.getAttribute("data-kp-account");
    return account ? account : "default";
  }

  function kpCurrentWorkMode() {
    try {
      return kpModeResolve(kpModeRead(kpModeAccount()));
    } catch (_error) {
      return "full";
    }
  }

  function kpModeApply(mode) {
    var resolved = kpModeResolve(mode);
    var meta = kpModeMeta(resolved);
    var strip = document.getElementById("kp-mode-strip");
    var dot = document.getElementById("kp-mode-dot");
    var select = document.getElementById("kp-mode-select");
    if (strip) strip.style.background = meta.band || meta.color;
    if (dot) dot.style.background = meta.color;
    if (select) {
      select.value = resolved;
      select.title = meta.label;
    }
  }

  function kpModeInit() {
    kpModeApply(kpModeRead(kpModeAccount()));
    var select = document.getElementById("kp-mode-select");
    if (!select || select.getAttribute("data-kp-mode-bound") === "1") return;
    select.setAttribute("data-kp-mode-bound", "1");
    select.addEventListener("change", function () {
      var mode = kpModeResolve(select.value);
      kpModeWrite(kpModeAccount(), mode);
      kpModeApply(mode);
    });
  }

  kpModeInit();

`;
