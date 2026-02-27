import { Module, forwardRef } from '@nestjs/common'
import { GameWebSocketServer } from './game.gateway'
import { MatchManagerService } from './match/match-manager.service'
import { LobbyService } from './lobby/lobby.service'
import { LobbyTrpc } from './lobby/lobby.trpc'
import { TrpcModule } from '../../trpc/trpc.module'

@Module({
  imports: [forwardRef(() => TrpcModule)],
  providers: [GameWebSocketServer, MatchManagerService, LobbyService, LobbyTrpc],
  exports: [GameWebSocketServer, MatchManagerService, LobbyService, LobbyTrpc],
})
export class GameModule {}
