# 往 AutoDL 公共模型库传模型

调研日期 2026-10-07。官方文档只写了「怎么用别人传的」，没写怎么传，下面「怎么传」这部分是从 autodl.art 网页的前端代码里读出来的（页面文案、调的接口、权限要求），没有实际传过。

## 结论

- AutoDL Art 有这个功能，在个人中心里叫「公共模型」。传上去的文件会挂到所有人的应用实例的 `/.autodl/` 下面，不管用的是哪个镜像都能看到，用 `ln -s` 链接到 ComfyUI 的模型文件夹就能用。页面原话：「这里上传的模型会被挂载到所有用户应用实例容器的/.autodl/路径下，所有人均可以访问」。
- 只有「应用创作者」账号能传。前端里「公共模型」「公共文件」两个页面都要求这个权限，权限是 AutoDL 后台管理员勾的，普通账号要找客服开。
- AutoDL 本站和 AutoDL Art 共用账号，但这个挂载只在 AutoDL Art 的应用实例里。本站文档里没有 `/.autodl/`，只有两样：
  - `/root/autodl-pub`：平台自己放的公共数据和模型，只读，自己传不进去。
  - `/root/autodl-fs`（文件存储）：自己的网盘，只挂到同一地区自己的实例上，20 GB 以内免费，超出每 GB 每天 1 分钱。

## 先看账号能不能传

登录 autodl.art，看个人菜单里有没有「公共模型」和「公共文件」两项。没有就找客服开应用创作者权限。

## 三种传法

**网页传**：「公共模型」页 →「上传模型」。

- 一次最多 50 个文件，分 10 MB 一块传，断了能续。
- 浏览器先算文件的 MD5，同一个文件别人已经传过就直接秒传。
- 文件名只能有字母、数字、`_ - . ( )` 和中文，带空格的选不进去。
- 要填模型名（必填）；类型选 Checkpoint、LORA 或其他；架构选 FLUX.1、SD 3、SDXL 1.0、SD 1.5 或其他；模型仓库和描述选填。
- 走的是这台电脑的上传带宽，几个 GB 的底模会很慢。

**命令行传**：在 AutoDL 的实例上跑，走机房的网，不占家里的带宽。适合模型已经在实例上的情况，比如先在实例上用 hf-mirror 下好。

```bash
wget https://codewithgpu.ks3-cn-beijing.ksyuncs.com/tools/cgtool && chmod +x cgtool
./cgtool upload model --token="临时Token" --name="模型名称" --description="描述" 模型文件路径
```

临时 Token 在「公共模型」页点「使用命令行工具上传」→「点击生成」，24 小时内有效。工具只有 Linux 版，Windows 和 Mac 版要找客服要。

**HuggingFace 或 ModelScope 的整个仓库**：页面上写的是找客服代下到公共模型目录。

## 传完怎么用

列表里每个文件有一列「实例路径」，像 `/.autodl/23/73/8c/23738c26b548113ea2d392abd91d3fd0`，按文件内容起名，原来的文件名不保留。直接点旁边的复制，别自己拼。

在任何一台应用实例里：

```bash
mkdir -p /root/autodl-tmp/models/loras/IL
ln -s /.autodl/23/73/8c/23738c26b548113ea2d392abd91d3fd0 /root/autodl-tmp/models/loras/IL/名字.safetensors
```

链接几乎不占硬盘。ComfyUI 刷新模型列表后就能选。实例被释放了，模型还在库里，新开的实例重新链一次就行。

## 代价和没查实的

- 传上去所有人都能读。自己训的 LoRA、有授权限制的模型，传之前想清楚。
- 「公共模型」页面没显示容量上限，也没写收费。同在个人中心的「公共文件」是另一样东西，页面上有存储容量条，超出免费额度要收费。
- 能删自己传的记录。别人已经链接了同一个文件时，删了会不会让别人的链接失效，没查到。
- AutoDL 本站的实例里到底有没有 `/.autodl/`，本站文档没提。要百分之百确认，在本站开一台无卡模式的实例，跑一下 `ls /.autodl` 看看。

## 和我们程序的关系

- 现在设置里「传模型」是传到那台实例自己的数据盘（`docs/dev-plan.md` 5.22），那台只剩 13 到 14 GB。改成走公共模型库，传一次所有实例都能链，不占盘。
- 程序列「自己传的」时会跳过软链接（`packages/server/src/comfy/models.ts:183`），链进来的自己的模型会看不到，要改。
- 网页上传和生成临时 Token 都用网页登录，不是设置里填的开发者 Token。程序要自动传，就得让用户每 24 小时贴一次临时 Token，或者在实例上用 cgtool。

## 来源

- [AutoDL Art：使用公共模型](https://www.autodl.art/docs/app_model/)（软链接的写法和路径样子）
- [AutoDL Art：应用使用指南](https://www.autodl.art/docs/app_quick_start/)（「先找别人传的公共模型，没有再用 JupyterLab 传自己的」）
- [AutoDL Art：镜像](https://www.autodl.art/docs/image/)（和 AutoDL 共用账号）
- [AutoDL：文件存储](https://www.autodl.com/docs/fs/)、[AutoDL：环境](https://www.autodl.com/docs/env/)（`/root/autodl-pub` 只读）
- autodl.art 前端代码：`/assets/creator.776c7f2c.js`（上传、命令行 Token、公共文件的接口），`/assets/index.aa16ff66.js`（「公共模型」页和命令行工具说明），`/assets/cg-upload.5ac8d0e0.js`（分块、MD5、文件名规则），入口 `/assets/index.9a933f79.js` 里两个页面的路由都要求 `application_creator` 权限
