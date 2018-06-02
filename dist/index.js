"use strict";

var crypto = require("crypto"), HTTP = require("http"), HTTPS = require("https"), cluster = require("cluster");

const noop = () => {}, OPCODE_TEXT = 1, OPCODE_PING = 9, OPCODE_BINARY = 2, APP_PONG_CODE = 65, APP_PING_CODE = Buffer.from("9"), PERMESSAGE_DEFLATE = 1, DEFAULT_PAYLOAD_LIMIT = 16777216, native = (() => {
    try {
        return require(`${require.resolve("uws").replace("uws.js", "")}uws_${process.platform}_${process.versions.modules}`);
    } catch (e) {
        const r = process.version.substring(1).split(".").map(e => parseInt(e, 10)), s = r[0] < 6 || 6 === r[0] && r[1] < 4;
        if ("win32" === process.platform && s) throw new Error("µWebSockets requires Node.js 8.0.0 or greater on Windows.");
        throw new Error("Could not run µWebSockets bindings");
    }
})();

native.setNoop(noop);

const clientGroup = native.client.group.create(0, DEFAULT_PAYLOAD_LIMIT);

native.client.group.onConnection(clientGroup, e => {
    const r = native.getUserData(e);
    r.external = e, r.internalOnOpen();
}), native.client.group.onDisconnection(clientGroup, (e, r, s, t) => {
    t.external = null, process.nextTick(() => t.internalOnClose(r, s)), native.clearUserData(e);
}), native.client.group.onError(clientGroup, e => {
    process.nextTick(() => e.internalOnError({
        message: "uWs client connection error",
        stack: "uWs client connection error"
    }));
}), native.client.group.onMessage(clientGroup, (e, r) => r.internalOnMessage(e)), 
native.client.group.onPing(clientGroup, (e, r) => r.onping(e)), native.client.group.onPong(clientGroup, (e, r) => r.onpong(e));

class UWebSocket {
    constructor(e, r = null, s = !1) {
        this.OPEN = 1, this.CLOSED = 0, this.isAlive = !0, this.external = noop, this.onping = noop, 
        this.onpong = noop, this.internalOnOpen = noop, this.internalOnError = noop, this.internalOnClose = noop, 
        this.internalOnMessage = noop, this.onpong = (() => this.isAlive = !0), this.external = r, 
        this.executeOn = s ? "server" : "client", !s && native.connect(clientGroup, e, this);
    }
    get readyState() {
        return this.external ? this.OPEN : this.CLOSED;
    }
    on(e, r) {
        return {
            ping: () => this.onping = r,
            pong: () => this.onpong = r,
            open: () => this.internalOnOpen = r,
            error: () => this.internalOnError = r,
            close: () => this.internalOnClose = r,
            message: () => this.internalOnMessage = r
        }[e](), this;
    }
    ping(e) {
        this.external && native[this.executeOn].send(this.external, e, OPCODE_PING);
    }
    send(e, r) {
        if (!this.external) return;
        const s = r && r.binary || "string" != typeof e;
        native[this.executeOn].send(this.external, e, s ? OPCODE_BINARY : OPCODE_TEXT, void 0);
    }
    terminate() {
        this.external && (native[this.executeOn].terminate(this.external), this.external = null);
    }
    close(e, r) {
        this.external && (native[this.executeOn].close(this.external, e, r), this.external = null);
    }
}

function logError(e) {
    return console.log(`[31m${e}[0m`);
}

function logReady(e) {
    return console.log(`[36m${e}[0m`);
}

function logWarning(e) {
    return console.log(`[33m${e}[0m`);
}

function isFunction(e) {
    return "[object Function]" === {}.toString.call(e);
}

function generateKey(e) {
    return crypto.randomBytes(Math.ceil(e / 2)).toString("hex").slice(0, e) + `${Date.now()}` + crypto.randomBytes(Math.ceil(e / 2)).toString("hex").slice(0, e);
}

class EventEmitterSingle {
    constructor() {
        this.events = {};
    }
    on(e, r) {
        if (!isFunction(r)) return logError("Listener must be a function");
        this.events[e] = r;
    }
    emit(e, ...r) {
        const s = this.events[e];
        s && s(...r);
    }
    removeEvents() {
        this.events = {};
    }
}

native.setNoop(noop);

class UWebSocketsServer extends EventEmitterSingle {
    constructor(e, r) {
        if (super(), this.upgradeReq = null, this.upgradeCallback = noop, this.lastUpgradeListener = !0, 
        !e || !e.port && !e.server && !e.noServer) throw new TypeError("Wrong options");
        this.noDelay = e.noDelay || !0, this.httpServer = e.server || HTTP.createServer((e, r) => r.end()), 
        this.serverGroup = native.server.group.create(e.perMessageDeflate ? PERMESSAGE_DEFLATE : 0, e.maxPayload || DEFAULT_PAYLOAD_LIMIT), 
        !e.path || e.path.length && "/" === e.path[0] || (e.path = `/${e.path}`), this.httpServer.on("upgrade", (r, s, t) => {
            if (e.path && e.path !== r.url.split("?")[0].split("#")[0]) this.lastUpgradeListener && this.abortConnection(s, 400, "URL not supported"); else if (e.verifyClient) {
                const n = {
                    origin: r.headers.origin,
                    secure: !(!r.connection.authorized && !r.connection.encrypted),
                    req: r
                };
                e.verifyClient(n, (e, n, o) => e ? this.handleUpgrade(r, s, t, this.emitConnection) : this.abortConnection(s, n, o));
            } else this.handleUpgrade(r, s, t, this.emitConnection);
        }), this.httpServer.on("error", e => this.emit("error", e)), this.httpServer.on("newListener", (e, r) => "upgrade" === e ? this.lastUpgradeListener = !1 : null), 
        native.server.group.onConnection(this.serverGroup, e => {
            const r = new UWebSocket(null, e, !0);
            native.setUserData(e, r), this.upgradeCallback(r), this.upgradeReq = null;
        }), native.server.group.onMessage(this.serverGroup, (e, r) => {
            if (this.pingIsAppLevel && ("string" != typeof e && (e = Buffer.from(e)), e[0] === APP_PONG_CODE)) return r.isAlive = !0;
            r.internalOnMessage(e);
        }), native.server.group.onDisconnection(this.serverGroup, (e, r, s, t) => {
            t.external = null, process.nextTick(() => t.internalOnClose(r, s)), native.clearUserData(e);
        }), native.server.group.onPing(this.serverGroup, (e, r) => r.onping(e)), native.server.group.onPong(this.serverGroup, (e, r) => r.onpong(e)), 
        e.port && this.httpServer.listen(e.port, e.host || null, () => {
            this.emit("listening"), r && r();
        });
    }
    heartbeat(e, r = !1) {
        r && (this.pingIsAppLevel = !0), setTimeout(() => {
            native.server.group.forEach(this.serverGroup, this.pingIsAppLevel ? this.sendPingsAppLevel : this.sendPings), 
            this.heartbeat(e);
        }, e);
    }
    sendPings(e) {
        e.isAlive ? (e.isAlive = !1, e.ping()) : e.terminate();
    }
    sendPingsAppLevel(e) {
        e.isAlive ? (e.isAlive = !1, e.send(APP_PING_CODE)) : e.terminate();
    }
    emitConnection(e) {
        this.emit("connection", e, this.upgradeReq);
    }
    abortConnection(e, r, s) {
        e.end(`HTTP/1.1 ${r} ${s}\r\n\r\n`);
    }
    handleUpgrade(e, r, s, t) {
        if (r._isNative) this.serverGroup && (this.upgradeReq = e, this.upgradeCallback = t || noop, 
        native.upgrade(this.serverGroup, r.external, null, e.headers["sec-websocket-extensions"], e.headers["sec-websocket-protocol"])); else {
            const s = e.headers["sec-websocket-key"], n = r.ssl ? r._parent._handle : r._handle, o = r.ssl ? r.ssl._external : null;
            if (n && s && 24 === s.length) {
                r.setNoDelay(this.noDelay);
                const i = native.transfer(-1 === n.fd ? n : n.fd, o);
                r.on("close", r => {
                    this.serverGroup && (this.upgradeReq = e, this.upgradeCallback = t || noop, native.upgrade(this.serverGroup, i, s, e.headers["sec-websocket-extensions"], e.headers["sec-websocket-protocol"]));
                });
            }
            r.destroy();
        }
    }
}

function encode(e, r, s) {
    const t = {
        emit: [ "e", e, r ],
        publish: [ "p", e, r ],
        system: {
            configuration: [ "s", "c", r ]
        }
    };
    return JSON.stringify({
        "#": t[s][e] || t[s]
    });
}

function decode(e, r) {
    const s = e.worker.options.encodeDecodeEngine ? e.worker.options.encodeDecodeEngine.decode(r["#"][2]) : r["#"][2], t = {
        e: () => e.events.emit(r["#"][1], s),
        p: () => e.channels[r["#"][1]] && e.worker.wss.publish(r["#"][1], s),
        s: {
            s: () => {
                const r = () => {
                    e.channels[s] = 1, e.worker.wss.channels.onMany(s, e.onPublishEvent);
                };
                e.worker.wss.middleware.onSubscribe ? e.worker.wss.middleware.onSubscribe(e, s, e => e && r()) : r();
            },
            u: () => {
                e.worker.wss.channels.removeListener(s, e.onPublishEvent), e.channels[s] = null;
            }
        }
    };
    return t[r["#"][0]][r["#"][1]] ? t[r["#"][0]][r["#"][1]]() : t[r["#"][0]] && t[r["#"][0]]();
}

class Socket {
    constructor(e, r) {
        this.worker = e, this.socket = r, this.events = new EventEmitterSingle(), this.channels = {}, 
        this.onPublishEvent = ((e, r) => this.send(e, r, "publish")), this.send("configuration", {
            ping: this.worker.options.pingInterval,
            binary: this.worker.options.useBinary
        }, "system"), this.socket.on("message", e => {
            try {
                decode(this, JSON.parse(e));
            } catch (e) {
                logError(`PID: ${process.pid}\n${e}\n`);
            }
        }), this.socket.on("close", (e, r) => {
            for (let e = 0, r = Object.keys(this.channels), s = r.length; e < s; e++) this.worker.wss.channels.removeListener(r[e], this.onPublishEvent);
            this.events.emit("disconnect", e, r);
        }), this.socket.on("error", e => this.events.emit("error", e));
    }
    on(e, r) {
        this.events.on(e, r);
    }
    send(e, r, s = "emit") {
        r = encode(e, r = this.worker.options.encodeDecodeEngine ? this.worker.options.encodeDecodeEngine.encode(r) : r, s), 
        this.socket.send(this.worker.options.useBinary ? Buffer.from(r) : r);
    }
    disconnect(e, r) {
        this.socket.close(e, r);
    }
    terminate() {
        this.socket.terminate();
    }
}

class EventEmitterMany {
    constructor() {
        this.events = {};
    }
    onMany(e, r) {
        if (!isFunction(r)) return logError("Listener must be a function");
        this.events[e] ? this.events[e].push(r) : (this.events[e] = [ r ], this.changeChannelStatusInBroker(e));
    }
    emitMany(e, ...r) {
        const s = this.events[e];
        if (s) for (let t = 0, n = s.length; t < n; t++) s[t](e, ...r);
    }
    removeListener(e, r) {
        const s = this.events[e];
        if (s) {
            for (let e = 0, t = s.length; e < t; e++) if (s[e] === r) return s.splice(e, 1);
            0 === s.length && (this.events[e] = null, this.changeChannelStatusInBroker(e));
        }
    }
    exist(e) {
        return this.events[e] && this.events[e].length > 0;
    }
    changeChannelStatusInBroker(e) {}
}

class WSServer extends EventEmitterSingle {
    constructor() {
        super(), this.channels = new EventEmitterMany(), this.middleware = {}, this.internalBrokers = {
            brokers: {},
            nextBroker: -1,
            brokersKeys: [],
            brokersAmount: 0
        }, this.channels.changeChannelStatusInBroker = (e => {
            for (let r = 0; r < this.internalBrokers.brokersAmount; r++) {
                const s = this.internalBrokers.brokers[this.internalBrokers.brokersKeys[r]];
                1 === s.readyState && s.send(e);
            }
        });
    }
    setMiddleware(e, r) {
        this.middleware[e] = r;
    }
    publishToWorkers(e) {
        this.publish("#sendToWorkers", e);
    }
    publish(e, r, s = 0) {
        if (s > 2 * this.internalBrokers.brokersAmount + 1) return logWarning("Does not have access to any broker");
        if (this.internalBrokers.brokersAmount <= 0) return setTimeout(() => this.publish(e, r, ++s), 10);
        this.internalBrokers.nextBroker >= this.internalBrokers.brokersAmount - 1 ? this.internalBrokers.nextBroker = 0 : this.internalBrokers.nextBroker++;
        const t = this.internalBrokers.brokers[this.internalBrokers.brokersKeys[this.internalBrokers.nextBroker]];
        return 1 !== t.readyState ? (delete this.internalBrokers.brokers[this.internalBrokers.brokersKeys[this.internalBrokers.nextBroker]], 
        this.internalBrokers.brokersKeys = Object.keys(this.internalBrokers.brokers), this.internalBrokers.brokersAmount--, 
        this.publish(e, r, ++s)) : (t.send(Buffer.from(`${e}%${JSON.stringify({
            message: r
        })}`)), "#sendToWorkers" === e ? this.middleware.onMessageFromWorker && this.middleware.onMessageFromWorker(r) : (this.channels.emitMany(e, r), 
        void (this.middleware.onPublish && this.middleware.onPublish(e, r))));
    }
    broadcastMessage(e, r) {
        const s = (r = Buffer.from(r)).indexOf(37), t = r.slice(0, s).toString(), n = JSON.parse(r.slice(s + 1)).message;
        if ("#sendToWorkers" === t) return this.middleware.onMessageFromWorker && this.middleware.onMessageFromWorker(n);
        this.middleware.onPublish && this.middleware.onPublish(t, n), this.channels.emitMany(t, n);
    }
    setBroker(e, r) {
        this.internalBrokers.brokers[r] = e, this.internalBrokers.brokersKeys = Object.keys(this.internalBrokers.brokers), 
        this.internalBrokers.brokersAmount = this.internalBrokers.brokersKeys.length;
        const s = Object.keys(this.channels.events);
        s.length && e.send(JSON.stringify(s));
    }
}

function BrokerClient(e, r, s = 0, t) {
    let n = new UWebSocket(e);
    n.on("open", () => {
        s = 0, r.setBroker(n, e), t && logReady(`Broker has been connected to ${e} \n`);
    }), n.on("close", (t, o) => {
        n = null, logWarning(`Broker has disconnected, system is trying to reconnect to ${e} \n`), 
        setTimeout(() => BrokerClient(e, r, ++s, !0), Math.floor(1e3 * Math.random()) + 500);
    }), n.on("error", o => {
        n = null, 5 === s && logWarning(`Can not connect to the Broker ${e}. System in reconnection please check your Broker and Token\n`), 
        setTimeout(() => BrokerClient(e, r, ++s, t || s > 5), Math.floor(1e3 * Math.random()) + 500);
    }), n.on("message", e => r.broadcastMessage(null, e));
}

class Worker {
    constructor(e, r) {
        this.options = e, this.wss = new WSServer();
        for (let e = 0; e < this.options.brokers; e++) BrokerClient(`ws://127.0.0.1:${this.options.brokersPorts[e]}/?token=${r}`, this.wss);
        this.server = this.options.tlsOptions ? HTTPS.createServer(this.options.tlsOptions) : HTTP.createServer();
        const s = new UWebSocketsServer({
            server: this.server,
            verifyClient: (e, r) => this.wss.middleware.verifyConnection ? this.wss.middleware.verifyConnection(e, r) : r(!0)
        });
        s.on("connection", e => this.wss.emit("connection", new Socket(this, e))), s.heartbeat(this.options.pingInterval, !0), 
        this.server.listen(this.options.port, this.options.host, () => {
            this.options.worker.call(this), process.send({
                event: "READY",
                pid: process.pid
            });
        });
    }
}

function GlobalBrokerServer(e, r, s) {
    const t = {
        sockets: {},
        length: 0,
        keys: []
    };
    let n;
    const o = {
        port: e,
        verifyClient: (e, s) => s(e.req.url === `/?token=${r}`)
    };
    if (s.masterOptions && s.masterOptions.tlsOptions) {
        const r = HTTPS.createServer(s.masterOptions.tlsOptions);
        o.port = null, o.server = r, n = new UWebSocketsServer(o), r.listen(e, () => process.send({
            event: "READY",
            pid: process.pid
        }));
    } else n = new UWebSocketsServer(o, () => process.send({
        event: "READY",
        pid: process.pid
    }));
    function i(e, r) {
        e.next >= e.length && (e.next = 0), e.wss[e.keys[e.next]].send(r), e.next++;
    }
    n.on("connection", e => {
        e.on("message", r => {
            "string" == typeof r ? (e.uid = generateKey(10), e.serverid = r, t.sockets[r] || (t.sockets[r] = {
                wss: {},
                next: 0,
                length: 0,
                keys: []
            }), t.sockets[r].wss[e.uid] = e, t.sockets[r].keys = Object.keys(t.sockets[r].wss), 
            t.sockets[r].length++, t.length++, t.keys = Object.keys(t.sockets)) : function(e, r) {
                for (let s = 0; s < t.length; s++) {
                    const n = t.keys[s];
                    n !== e && i(t.sockets[n], r);
                }
            }(e.serverid, r);
        }), e.on("close", (r, s) => {
            delete t.sockets[e.serverid].wss[e.uid], t.sockets[e.serverid].keys = Object.keys(t.sockets[e.serverid].wss), 
            t.sockets[e.serverid].length--, t.sockets[e.serverid].length || (delete t.sockets[e.serverid], 
            t.keys = Object.keys(t.sockets), t.length--), e = null;
        });
    }), n.heartbeat(2e4);
}

function InternalBrokerServer(e, r, s) {
    const t = {
        sockets: {},
        length: 0,
        keys: []
    }, n = {
        brokers: {},
        nextBroker: -1,
        brokersKeys: [],
        brokersAmount: 0
    }, o = new UWebSocketsServer({
        port: e,
        verifyClient: (e, s) => s(e.req.url === `/?token=${r}`)
    }, () => process.send({
        event: "READY",
        pid: process.pid
    }));
    if (o.on("connection", e => {
        e.uid = generateKey(10), e.channels = {
            "#sendToWorkers": !0
        }, t.sockets[e.uid] = e, t.length++, t.keys = Object.keys(t.sockets), e.on("message", r => {
            if ("string" == typeof r) if ("[" !== r[0]) e.channels[r] = e.channels[r] ? null : 1; else {
                const s = JSON.parse(r);
                for (let r = 0, t = s.length; r < t; r++) e.channels[s[r]] = !0;
            } else l(e.uid, r), s && function e(r) {
                if (n.brokersAmount <= 0) return;
                n.nextBroker >= n.brokersAmount - 1 ? n.nextBroker = 0 : n.nextBroker++;
                const s = n.brokers[n.brokersKeys[n.nextBroker]];
                if (1 !== s.readyState) return delete n.brokers[n.brokersKeys[n.nextBroker]], n.brokersKeys = Object.keys(n.brokers), 
                n.brokersAmount--, e(r);
                s.send(r);
            }(r);
        }), e.on("close", (r, s) => {
            delete t.sockets[e.uid], t.length--, t.keys = Object.keys(t.sockets), e = null;
        });
    }), o.heartbeat(2e4), s) {
        s.masterOptions && i(`${s.masterOptions.tlsOptions ? "wss" : "ws"}://127.0.0.1:${s.masterOptions.port}/?token=${s.key}`);
        for (let e = 0, r = s.brokersUrls.length; e < r; e++) i(`${s.brokersUrls[e]}/?token=${s.key}`);
    }
    function i(e) {
        BrokerClient(e, {
            broadcastMessage: l,
            setBroker: (e, r) => {
                n.brokers[r] = e, n.brokersKeys = Object.keys(n.brokers), n.brokersAmount = n.brokersKeys.length, 
                e.send(s.serverID);
            }
        });
    }
    function l(e, r) {
        const s = Buffer.from(r), n = s.slice(0, s.indexOf(37)).toString();
        for (let s = 0; s < t.length; s++) {
            const o = t.keys[s];
            if (o !== e) {
                const e = t.sockets[o];
                e.channels[n] && e.send(r);
            }
        }
    }
}

class ClusterWS {
    constructor(e) {
        const r = {
            port: e.port || (e.tlsOptions ? 443 : 80),
            host: e.host || null,
            worker: e.worker,
            workers: e.workers || 1,
            brokers: e.brokers || 1,
            useBinary: e.useBinary || !1,
            brokersPorts: e.brokersPorts || [],
            tlsOptions: e.tlsOptions || !1,
            pingInterval: e.pingInterval || 2e4,
            restartWorkerOnFail: e.restartWorkerOnFail || !1,
            horizontalScaleOptions: e.horizontalScaleOptions || !1,
            encodeDecodeEngine: e.encodeDecodeEngine || !1
        };
        if (r.horizontalScaleOptions && (r.horizontalScaleOptions.serverID = generateKey(10)), 
        !isFunction(r.worker)) return logError("Worker param must be provided and it must be a function \n");
        if (!e.brokersPorts) for (let e = 0; e < r.brokers; e++) r.brokersPorts.push(e + 9400);
        if (r.brokersPorts.length !== r.brokers) return logError("Number of broker ports should be the same as number of brokers\n");
        cluster.isMaster ? this.masterProcess(r) : this.workerProcess(r);
    }
    masterProcess(e) {
        let r = !1;
        const s = generateKey(16), t = {}, n = {};
        if (e.horizontalScaleOptions && e.horizontalScaleOptions.masterOptions) o("Scaler", -1); else for (let r = 0; r < e.brokers; r++) o("Broker", r);
        function o(i, l) {
            let a = cluster.fork();
            a.on("message", s => "READY" === s.event && function(s, i, l) {
                if (r) return logReady(`${s} PID ${l} has been restarted`);
                "Worker" === s && (n[i] = `\tWorker: ${i}, PID ${l}`);
                if ("Scaler" === s) for (let r = 0; r < e.brokers; r++) o("Broker", r);
                if ("Broker" === s && (t[i] = `>>>  Broker on: ${e.brokersPorts[i]}, PID ${l}`, 
                Object.keys(t).length === e.brokers)) for (let r = 0; r < e.workers; r++) o("Worker", r);
                Object.keys(t).length === e.brokers && Object.keys(n).length === e.workers && (r = !0, 
                logReady(`>>>  Master on: ${e.port}, PID: ${process.pid} ${e.tlsOptions ? " (secure)" : ""}`), 
                Object.keys(t).forEach(e => t.hasOwnProperty(e) && logReady(t[e])), Object.keys(n).forEach(e => n.hasOwnProperty(e) && logReady(n[e])));
            }(i, l, s.pid)), a.on("exit", () => {
                a = null, logError(`${i} has exited \n`), e.restartWorkerOnFail && (logWarning(`${i} is restarting \n`), 
                o(i, l));
            }), a.send({
                securityKey: s,
                processId: l,
                processName: i
            });
        }
    }
    workerProcess(e) {
        process.on("message", r => {
            const s = {
                Worker: () => new Worker(e, r.securityKey),
                Broker: () => InternalBrokerServer(e.brokersPorts[r.processId], r.securityKey, e.horizontalScaleOptions),
                Scaler: () => e.horizontalScaleOptions && GlobalBrokerServer(e.horizontalScaleOptions.masterOptions.port, e.horizontalScaleOptions.key || "", e.horizontalScaleOptions)
            };
            s[r.processName] && s[r.processName]();
        }), process.on("uncaughtException", e => {
            logError(`PID: ${process.pid}\n ${e.stack}\n`), process.exit();
        });
    }
}

ClusterWS.uWebSocket = UWebSocket, ClusterWS.uWebSocketServer = UWebSocketsServer, 
module.exports = ClusterWS, module.exports.default = ClusterWS;
