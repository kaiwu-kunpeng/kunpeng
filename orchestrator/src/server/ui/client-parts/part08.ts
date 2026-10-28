export const part08: string = `  function kpModeResolve(raw) {
    if (raw === "full" || raw === "intranet" || raw === "trip") return raw;
    return "full";
  }

  function kpModeStorageKey(account) {
    var accountKey = account === null || account === undefined || account === "" ? "default" : String(account);
    return "kp-mode:" + accountKey;
  }

  function kpModeMeta(mode) {
    var resolved = typeof kpModeResolve === "function"
      ? kpModeResolve(mode)
      : (mode === "full" || mode === "intranet" || mode === "trip" ? mode : "full");
    var meta = new Object();
    if (resolved === "intranet") {
      meta.label = "内网";
      meta.color = "#2563EB";
      meta.band = meta.color;
      return meta;
    }
    if (resolved === "trip") {
      meta.label = "出差";
      meta.color = "#D97706";
      meta.band = "repeating-linear-gradient(45deg, #D97706 0, #D97706 6px, #7C2D12 6px, #7C2D12 12px)";
      return meta;
    }
    meta.label = "满血";
    meta.color = "#EA580C";
    meta.band = meta.color;
    return meta;
  }

  function kpModeRead(account) {
    try {
      return kpModeResolve(localStorage.getItem(kpModeStorageKey(account)));
    } catch (_error) {
      return "full";
    }
  }

  function kpModeWrite(account, mode) {
    try {
      localStorage.setItem(kpModeStorageKey(account), kpModeResolve(mode));
    } catch (_error) {
      // localStorage may be unavailable in privacy-restricted browsers.
    }
  }

`;
