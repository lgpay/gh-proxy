'use strict'

/**
 * static files (404.html, sw.js, conf.js)
 */
const ASSET_URL = 'https://lgpay.github.io/gh-proxy/'
// 前缀，如果自定义路由为example.com/gh/*，将PREFIX改为 '/gh/'，注意，少一个杠都会错！
const PREFIX = '/'
// 分支文件使用jsDelivr镜像的开关，0为关闭，1为开启（raw / github blob 走 jsDelivr CDN 加速）
const Config = {
    jsdelivr: 1
}

const whiteList = [] // 白名单，路径里面有包含字符的才会通过，e.g. ['/username/']

/** @type {ResponseInit} */
const PREFLIGHT_INIT = {
    status: 204,
    headers: new Headers({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    }),
}

// ---- URL 规则（命名常量，便于阅读与复用）----
const expReleasesArchive = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
const expBlobRaw = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
const expInfoGit = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
const expRaw = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
const expGist = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
const expTags = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i

// 所有规则，统一用于 checkUrl
const ALL_EXPS = [expReleasesArchive, expBlobRaw, expInfoGit, expRaw, expGist, expTags]
// 命中后直接走代理的分支（blob/raw 另有独立处理，排除在外）
const PROXY_EXPS = [expReleasesArchive, expInfoGit, expRaw, expGist, expTags]

const expShort = /^(?!https?:\/\/)(?!raw\.(?:githubusercontent|github)\.com\/)(?!gist\.(?:githubusercontent|github)\.com\/)(?!github\.com\/)(?!cdn\.jsdelivr\.net\/)([^/?#]+\/[^/?#]+\/(?:releases|archive|blob|raw)\/.*|[^/?#]+\/[^/?#]+\/(?:info|git-).*)$/i

/**
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*'
    return new Response(body, {status, headers})
}

/**
 * @param {string} urlStr
 */
function newUrl(urlStr) {
    try {
        return new URL(urlStr)
    } catch (err) {
        return null
    }
}

/**
 * 用统一数组判定 path 是否命中任一规则
 * @param {string} path
 * @param {RegExp[]} exps
 */
function matchesAny(path, exps = ALL_EXPS) {
    return exps.some(re => path.search(re) === 0)
}

function normalizeTarget(path) {
    if (!path) {
        return path
    }
    if (path.search(expShort) === 0) {
        return 'https://github.com/' + path
    }
    return path
}

function checkUrl(u) {
    return matchesAny(u, ALL_EXPS)
}

/**
 * @param {Request} request
 * @param {object} ctx Workers 运行上下文（用于 waitUntil）
 */
async function fetchHandler(request, ctx) {
    const urlStr = request.url
    const urlObj = new URL(urlStr)
    let path = urlObj.searchParams.get('q')
    if (path) {
        return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
    }
    // cfworker 会把路径中的 `//` 合并成 `/`
    path = urlObj.href.slice(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')
    path = normalizeTarget(path)

    // raw.githubusercontent.com -> jsDelivr（可选开关）
    if (Config.jsdelivr && path.search(expRaw) === 0) {
        const jsdUrl = path
            .replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1')
            .replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
        return Response.redirect(jsdUrl, 302)
    }

    // github.com 的 blob/raw
    if (path.search(expBlobRaw) === 0) {
        if (Config.jsdelivr) {
            const jsdUrl = path
                .replace('/blob/', '@')
                .replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
            return Response.redirect(jsdUrl, 302)
        }
        path = path.replace('/blob/', '/raw/')
        return httpHandler(request, path, ctx)
    }

    if (matchesAny(path, PROXY_EXPS)) {
        return httpHandler(request, path, ctx)
    }

    return fetch(ASSET_URL + path)
}

/**
 * @param {Request} req
 * @param {string} pathname
 * @param {object} ctx
 */
async function httpHandler(req, pathname, ctx) {
    const reqHdrRaw = req.headers

    // preflight
    if (req.method === 'OPTIONS' &&
        reqHdrRaw.has('access-control-request-headers')
    ) {
        return new Response(null, PREFLIGHT_INIT)
    }

    const reqHdrNew = new Headers(reqHdrRaw)

    let urlStr = pathname
    let flag = !Boolean(whiteList.length)
    for (let i of whiteList) {
        if (urlStr.includes(i)) {
            flag = true
            break
        }
    }
    if (!flag) {
        return new Response("blocked", {status: 403})
    }
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }
    const urlObj = newUrl(urlStr)

    /** @type {RequestInit} */
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: req.body
    }

    // 边缘缓存：仅缓存 GET 且无 Range 请求的成功响应（200/206）
    if (req.method === 'GET' && !reqHdrRaw.has('range')) {
        const cache = caches.default
        const cacheKey = new Request(urlObj.href)
        const cached = await cache.match(cacheKey)
        if (cached) {
            return cached
        }
        const res = await proxy(urlObj, reqInit)
        if (res.status === 200 || res.status === 206) {
            const copy = res.clone()
            copy.headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=86400')
            if (ctx && ctx.waitUntil) {
                ctx.waitUntil(cache.put(cacheKey, copy))
            } else {
                await cache.put(cacheKey, copy)
            }
        }
        return res
    }

    return proxy(urlObj, reqInit)
}

/**
 *
 * @param {URL} urlObj
 * @param {RequestInit} reqInit
 */
async function proxy(urlObj, reqInit) {
    const res = await fetch(urlObj.href, reqInit)
    const resHdrOld = res.headers
    const resHdrNew = new Headers(resHdrOld)

    const status = res.status

    if (resHdrNew.has('location')) {
        let _location = resHdrNew.get('location')
        if (checkUrl(_location))
            resHdrNew.set('location', PREFIX + _location)
        else {
            reqInit.redirect = 'follow'
            return proxy(newUrl(_location), reqInit)
        }
    }
    resHdrNew.set('access-control-expose-headers', '*')
    resHdrNew.set('access-control-allow-origin', '*')

    resHdrNew.delete('content-security-policy')
    resHdrNew.delete('content-security-policy-report-only')
    resHdrNew.delete('clear-site-data')

    return new Response(res.body, {
        status,
        headers: resHdrNew,
    })
}

export default {
    async fetch(request, env, ctx) {
        try {
            return await fetchHandler(request, ctx)
        } catch (err) {
            return makeRes('cfworker error:\n' + err.stack, 502)
        }
    }
}
