/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Zero-dependency Express-compatible router fallback for standalone test execution.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.1.0: a plain middleware (use(fn)) runs for every request instead of failing on a missing pattern, so the owner check runs here as it does in the kernel's runner.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

class MiniRouter {
  constructor() {
    this.routes = [];
  }

  use(...args) {
    if (args.length === 1 && typeof args[0] === "function") {
      this.routes.push({ method: null, prefix: null, middleware: args[0] });
    } else if (args.length >= 2 && typeof args[0] === "string") {
      const prefix = args[0].replace(/\/+$/, "");
      const sub = args[1];
      if (sub && sub.handle) {
        this.routes.push({
          method: null,
          prefix,
          handler: (req, res, next) => {
            if (req.url === prefix || req.url.startsWith(prefix + "/") || req.url.startsWith(prefix + "?")) {
              const origUrl = req.url;
              req.url = req.url.slice(prefix.length) || "/";
              sub.handle(req, res, () => {
                req.url = origUrl;
                next();
              });
            } else {
              next();
            }
          }
        });
      }
    }
  }

  get(pathStr, ...handlers) {
    this.addRoute("GET", pathStr, handlers);
  }

  post(pathStr, ...handlers) {
    this.addRoute("POST", pathStr, handlers);
  }

  delete(pathStr, ...handlers) {
    this.addRoute("DELETE", pathStr, handlers);
  }

  addRoute(method, pathStr, handlers) {
    const paramNames = [];
    const cleanPath = (pathStr === "/" ? "" : pathStr);
    const regexStr = "^" + (cleanPath ? cleanPath.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    }) : "") + "/?$";
    const regex = new RegExp(regexStr);

    this.routes.push({
      method,
      pathStr,
      regex,
      paramNames,
      handlers: handlers.flat()
    });
  }

  handle(req, res, finalNext) {
    if (!res.status) {
      res.status = function(code) {
        res.statusCode = code;
        return res;
      };
    }
    if (!res.json) {
      res.json = function(data) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
      };
    }
    if (!res.send) {
      res.send = function(data) {
        if (typeof data === "object" && !Buffer.isBuffer(data)) {
          return res.json(data);
        }
        res.end(data);
      };
    }
    if (!res.sendFile) {
      res.sendFile = function(filePath) {
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          return res.end("Not Found");
        }
        const ext = path.extname(filePath);
        const mimeTypes = {
          ".html": "text/html",
          ".css": "text/css",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".json": "application/json",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".jpg": "image/jpeg"
        };
        if (mimeTypes[ext]) {
          res.setHeader("Content-Type", mimeTypes[ext]);
        }
        fs.createReadStream(filePath).pipe(res);
      };
    }
    if (!res.type) {
      res.type = function(t) {
        res.setHeader("Content-Type", t);
        return res;
      };
    }

    const startProcessing = () => {
      const parsedUrl = new URL(req.url, "http://localhost");
      const pathname = parsedUrl.pathname;
      req.path = pathname;
      req.query = Object.fromEntries(parsedUrl.searchParams.entries());

      let i = 0;
      const next = (err) => {
        if (err) {
          res.statusCode = 500;
          return res.json({ error: "internal_server_error", message: err.message });
        }
        if (i >= this.routes.length) {
          if (finalNext) return finalNext();
          res.statusCode = 404;
          return res.json({ error: "not_found" });
        }

        const route = this.routes[i++];
        if (route.middleware) {
          return route.middleware(req, res, next);
        }
        if (route.prefix) {
          return route.handler(req, res, next);
        }

        if (route.method && route.method !== req.method) {
          return next();
        }

        const match = pathname.match(route.regex);
        if (!match) {
          return next();
        }

        req.params = {};
        route.paramNames.forEach((pName, idx) => {
          req.params[pName] = decodeURIComponent(match[idx + 1]);
        });

        let hIdx = 0;
        const runHandler = () => {
          if (hIdx >= route.handlers.length) {
            return next();
          }
          const fn = route.handlers[hIdx++];
          try {
            const ret = fn.length >= 3 ? fn(req, res, runHandler) : fn(req, res);
            if (ret && typeof ret.catch === "function") {
              ret.catch(next);
            }
          } catch (e) {
            next(e);
          }
        };
        runHandler();
      };

      next();
    };

    if (req.body === undefined && (req.method === "POST" || req.method === "PUT" || req.method === "PATCH")) {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          req.body = raw ? JSON.parse(raw) : {};
        } catch {
          req.body = {};
        }
        startProcessing();
      });
    } else {
      startProcessing();
    }
  }
}

function createRouter() {
  return new MiniRouter();
}

function json() {
  return (req, res, next) => next();
}

module.exports = { createRouter, json, MiniRouter };

