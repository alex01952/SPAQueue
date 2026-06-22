"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppController = void 0;
const common_1 = require("@nestjs/common");
const app_service_1 = require("./app.service");
let AppController = class AppController {
    appService;
    constructor(appService) {
        this.appService = appService;
    }
    async getMonthlyParticipationSummary() {
        return this.appService.getMonthlyParticipationSummary();
    }
    getQueueSnapshot(courtCount, selectionMode, matchingMode) {
        return this.appService.getQueueSnapshot(courtCount, selectionMode, matchingMode);
    }
    updatePlayerReadyState(id, isReady) {
        return this.appService.updatePlayerReadyState(id, isReady);
    }
    createGame(playerIds) {
        return this.appService.createGame(playerIds ?? []);
    }
    createGames(gameAssignments, playerGroups) {
        const normalizedAssignments = gameAssignments ??
            (playerGroups ?? []).map((group, index) => ({ courtNumber: index + 1, playerIds: group }));
        return this.appService.createGames(normalizedAssignments);
    }
    async importParticipantsFromText(sourceText) {
        return this.appService.importParticipantsFromText(sourceText ?? '');
    }
    completeGame(id, score) {
        return this.appService.completeGame(id, score);
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.Get)('participation/monthly'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "getMonthlyParticipationSummary", null);
__decorate([
    (0, common_1.Get)('queue'),
    __param(0, (0, common_1.Query)('courtCount', new common_1.DefaultValuePipe(1), common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('selectionMode', new common_1.DefaultValuePipe('queue-line'))),
    __param(2, (0, common_1.Query)('matchingMode', new common_1.DefaultValuePipe('dupr-balance'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String]),
    __metadata("design:returntype", void 0)
], AppController.prototype, "getQueueSnapshot", null);
__decorate([
    (0, common_1.Patch)('players/:id/ready'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)('isReady', common_1.ParseBoolPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Boolean]),
    __metadata("design:returntype", void 0)
], AppController.prototype, "updatePlayerReadyState", null);
__decorate([
    (0, common_1.Post)('games'),
    __param(0, (0, common_1.Body)('playerIds')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Array]),
    __metadata("design:returntype", void 0)
], AppController.prototype, "createGame", null);
__decorate([
    (0, common_1.Post)('games/batch'),
    __param(0, (0, common_1.Body)('gameAssignments')),
    __param(1, (0, common_1.Body)('playerGroups')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Array, Array]),
    __metadata("design:returntype", void 0)
], AppController.prototype, "createGames", null);
__decorate([
    (0, common_1.Post)('queue/import-participants'),
    __param(0, (0, common_1.Body)('sourceText')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "importParticipantsFromText", null);
__decorate([
    (0, common_1.Patch)('games/:id/complete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], AppController.prototype, "completeGame", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [app_service_1.AppService])
], AppController);
//# sourceMappingURL=app.controller.js.map