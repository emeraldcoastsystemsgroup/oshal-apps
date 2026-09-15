"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJECT_ASSET_PREFIX = exports.PROJECT_LIMITS = exports.ProjectError = void 0;
class ProjectError extends Error {
    status;
    code;
    constructor(status, code) {
        super(code);
        this.status = status;
        this.code = code;
    }
}
exports.ProjectError = ProjectError;
exports.PROJECT_LIMITS = Object.freeze({ documentBytes: 262144, layers: 200, depth: 12, nodes: 100000,
    dimension: 8192, pixels: 33554432, title: 160, projects: 1000, revisions: 1000,
    imageBytes: 8388608, assets: 128, assetBytes: 536870912 });
exports.PROJECT_ASSET_PREFIX = '/api/create/project-assets/';
//# sourceMappingURL=create-project-types.js.map