import https from 'https'
import { ImgType } from './lib/interface'

const UPLOADER = 'lskypro'

module.exports = (ctx) => {
  const register = () => {
    ctx.helper.uploader.register(UPLOADER, {
      handle,
      name: UPLOADER,
      config: config
    })

    // 注册同步删除 remove 事件
    ctx.on('remove', onDelete)
  }

  async function onDelete(files, guiApi) {
    let userConfig = ctx.getConfig('picBed.' + UPLOADER)
    const syncDelete = userConfig.syncDelete
    // 如果同步删除按钮关闭则不执行
    if (!syncDelete) {
      return
    }
    const isV2 = userConfig.lskyProVersion === 'V2'
    if (!isV2) {
      ctx.emit('notification', {
        title: `V1版本的兰空图床不支持同步删除, 请关闭同步删除选项以抑制此通知`
      })
    }
    const deleteList = files.filter(each => each.type === UPLOADER)
    if (deleteList.length === 0) {
      return
    }

    for (let i = 0; i < deleteList.length; i++) {
      const item = deleteList[i]
      const deleteParam = GenDeleteParam(item, userConfig)
      let body = await ctx.Request.request(deleteParam)

      body = typeof body === 'string' ? JSON.parse(body) : body
      if (body.status === true) {
        ctx.emit('notification', {
          title: `${item.imgUrl} 删除请求已发送`,
          body: '删除操作可能需要几分钟生效，请稍后刷新确认'
        })
      }
      else {
        ctx.emit('notification', {
          title: `${item.imgUrl} 同步删除失败`,
          body: body.message
        })
        throw new Error(body.message)
      }
    }
  }

  const GenDeleteParam = (img: ImgType, userConfig) => {
    // 自动处理 token 格式：如果用户输入的 token 不包含 "Bearer "，自动添加
    let token = userConfig.token
    if (token && !token.startsWith('Bearer ')) {
      token = 'Bearer ' + token
    }
    const ignoreCertErr = userConfig.ignoreCertErr
    const serverUrl = userConfig.server
    const currentImageKey = img.id

    const v2Headers = {
      'Accept': 'application/json',
      'User-Agent': 'PicGo',
      'Connection': 'keep-alive',
      'Authorization': token || undefined
    }

    // 如果忽略证书错误开关打开则带上 http agent 访问, 否则不需要带（以提高性能）
    if (ignoreCertErr) {
      let requestAgent = new https.Agent({
        // 此处需要取反 忽略证书错误 拒绝未授权证书选项
        rejectUnauthorized: !ignoreCertErr
      })
      return {
        method: 'DELETE',
        url: `${serverUrl}/api/v1/images/${currentImageKey}`,
        agent: requestAgent,
        headers: v2Headers
      }
    }
    else {
      return {
        method: 'DELETE',
        url: `${serverUrl}/api/v1/images/${currentImageKey}`,
        headers: v2Headers
      }
    }

  }


  const postOptions = (userConfig, fileName, image) => {

    const serverUrl = userConfig.server
    if (serverUrl.endsWith("/")) {
      throw new Error("Server url cannot ends with /")
    }
    const isV2 = userConfig.lskyProVersion === 'V2'
    // 自动处理 token 格式：如果用户输入的 token 不包含 "Bearer "，自动添加
    let token = userConfig.token
    if (token && !token.startsWith('Bearer ')) {
      token = 'Bearer ' + token
    }
    const ignoreCertErr = userConfig.ignoreCertErr

    const v1Headers = {
      'Content-Type': 'multipart/form-data',
      'User-Agent': 'PicGo',
      'Connection': 'keep-alive',
      'token': token || undefined
    }
    const v1FormData = {
      image: {
        value: image,
        options: {
          filename: fileName
        }
      },
      ssl: 'true'
    }

    const v2Headers = {
      'Content-Type': 'multipart/form-data',
      'User-Agent': 'PicGo',
      'Connection': 'keep-alive',
      'Accept': 'application/json',
      'Authorization': token || undefined
    }
    const strategyId = userConfig.strategyId
    const albumId = userConfig.albumId
    let permission = userConfig.permission.value
    if (permission === undefined) {
      permission = userConfig.permission
    }
    const v2FormData = {
      file: {
        value: image,
        options: {
          filename: fileName
        }
      },
      ssl: 'true',
      strategy_id: strategyId,
      album_id: albumId,
      permission: permission
    }
    // V2版本情况下, 如果用户没有填写策略ID, 使用默认值 1
    if (!strategyId) {
      v2FormData.strategy_id = '1'
    }
    if (!albumId) {
      delete v2FormData.album_id
    }
    if (!(permission === 0 || permission === 1)) {
      delete v2FormData.permission
    }

    // 如果忽略证书错误开关打开则带上 http agent 访问, 否则不需要带（以提高性能）
    if (ignoreCertErr) {
      let requestAgent = new https.Agent({
        // 此处需要取反 忽略证书错误 拒绝未授权证书选项
        rejectUnauthorized: !ignoreCertErr
      })
      return {
        method: 'POST',
        url: isV2 ? `${serverUrl}/api/v1/upload` : `${serverUrl}/api/upload`,
        agent: requestAgent,
        headers: isV2 ? v2Headers : v1Headers,
        formData: isV2 ? v2FormData : v1FormData
      }
    }
    else {
      return {
        method: 'POST',
        url: isV2 ? `${serverUrl}/api/v1/upload` : `${serverUrl}/api/upload`,
        headers: isV2 ? v2Headers : v1Headers,
        formData: isV2 ? v2FormData : v1FormData
      }
    }
  }
  const handle = async (ctx) => {
    let userConfig = ctx.getConfig('picBed.' + UPLOADER)
    if (!userConfig) {
      throw new Error('Can\'t find uploader config')
    }
    const imgList = ctx.output
    for (let i in imgList) {
      let image = imgList[i].buffer
      if (!image && imgList[i].base64Image) {
        image = Buffer.from(imgList[i].base64Image, 'base64')
      }
      const postConfig = postOptions(userConfig, imgList[i].fileName, image)
      let body = await ctx.Request.request(postConfig)

      body = JSON.parse(body)
      let isV2 = userConfig.lskyProVersion === 'V2'
      let condition = isV2 ? (body.status === true) : (body.code === 200)

      if (condition) {
        delete imgList[i].base64Image
        delete imgList[i].buffer
        imgList[i]['imgUrl'] = isV2 ? body.data.links.url : body.data.url
        if (isV2) {
          imgList[i]['id'] = body.data.key
        }
      }
      else {
        ctx.emit('notification', {
          title: 'upload failed',
          body: body.message
        })
        throw new Error(body.message)
      }
    }
    return ctx
  }

  const config = ctx => {
    let userConfig = ctx.getConfig('picBed.' + UPLOADER)
    if (!userConfig) {
      userConfig = {}
    }
    return [
      {
        name: 'lskyProVersion',
        type: 'list',
        default: userConfig.lskyProVersion || 'V2',
        message: '选择 Lsky Pro 版本',
        choices: [
          {
            name: 'V1 - 旧版本',
            value: 'V1'
          },
          {
            name: 'V2 - 新版本（推荐）',
            value: 'V2'
          }
        ],
        required: true,
        alias: 'Lsky Pro Version'
      },
      {
        name: 'server',
        type: 'input',
        default: userConfig.server,
        required: true,
        message: '图床地址，如: https://img.example.com (不要以/结尾)',
        alias: 'Server URL'
      },
      {
        name: 'token',
        type: 'input',
        default: userConfig.token,
        required: true,
        message: '直接粘贴 Token 即可，无需添加 Bearer 前缀',
        alias: 'Auth Token'
      },
      {
        name: 'strategyId',
        type: 'input',
        default: userConfig.strategyId || '1',
        required: false,
        message: 'V2必填，默认1。查看策略: 浏览器访问 你的域名/api/v1/strategies',
        alias: 'Strategy ID'
      },
      {
        name: 'albumId',
        type: 'input',
        default: userConfig.albumId,
        required: false,
        message: '相册ID，选填 (仅V2生效)',
        alias: 'Album ID'
      },
      {
        name: 'permission',
        type: 'list',
        default: userConfig.permission || 'private(default)',
        message: '图片权限 (仅V2生效)',
        choices: [
          {
            name: 'private(default) - 私有',
            value: 0
          },
          {
            name: 'public - 公开',
            value: 1
          }
        ],
        required: false,
        alias: 'Permission'
      },
      {
        name: 'ignoreCertErr',
        type: 'confirm',
        default: userConfig.ignoreCertErr || false,
        message: '忽略SSL证书错误 (上传失败提示证书过期时开启)',
        required: true,
        alias: 'Ignore Certificate Error'
      },
      {
        name: 'syncDelete',
        type: 'confirm',
        default: userConfig.syncDelete || false,
        message: '同步删除 (仅V2支持，删除本地图片时同步删除服务器)',
        required: true,
        alias: 'Sync Delete'
      }
    ]
  }
  return {
    uploader: UPLOADER,
    config: config,
    register
    // guiMenu
  }
}
