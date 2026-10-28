# 外置 recipe 运行手册

客户专属 recipe 不进入产品仓。服务启动时，外置加载器扫描
`<KUNPENG_STATE>/recipes/<name>/index.js`，并动态导入每个 recipe 的入口模块。

入口模块应在加载时完成自注册：

```js
import { recipeRegistry } from "<kunpeng-package>/loop/recipe.js";

recipeRegistry[definition.id] = definition;
```

`definition.id` 必须与 loop 配置引用的 recipe id 一致。单个模块加载失败时，服务只记录告警并继续启动；运维人员应根据告警中的模块路径和错误信息修复构建或依赖问题。

把现有客户 recipe 搬到客户仓时：

1. 将 recipe 源码及其客户专属测试复制到客户仓，并在客户仓内维护依赖。
2. 在客户仓构建出可由当前 Node.js 运行时导入的 `index.js`，确保该入口执行 `recipeRegistry[id] = def` 自注册。
3. 在 `<KUNPENG_STATE>/recipes/` 下创建以 recipe 命名的目录。
4. 将客户仓的构建目录软链到该目录，或把构建产物复制进去，使最终入口位于 `<KUNPENG_STATE>/recipes/<name>/index.js`。
5. 重启服务并检查启动日志，确认入口已加载；若出现告警，先修复后再运行引用该 recipe 的 loop。
