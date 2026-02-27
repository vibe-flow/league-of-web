import { Injectable, Inject } from '@nestjs/common'
import { TrpcService } from '../../../trpc/trpc.service'
import { LobbyService } from './lobby.service'
import {
  JoinLobbySchema,
  SetTeamSchema,
  SetReadySchema,
  StartMatchSchema,
  GetLobbySchema,
} from '@template-dev/shared'

@Injectable()
export class LobbyTrpc {
  router: ReturnType<TrpcService['router']>

  constructor(
    @Inject(TrpcService) private readonly trpc: TrpcService,
    @Inject(LobbyService) private readonly lobbyService: LobbyService,
  ) {
    this.router = this.trpc.router({
      create: this.trpc.protectedProcedure.mutation(({ ctx }) => {
        return this.lobbyService.createLobby(ctx.user.userId)
      }),

      join: this.trpc.protectedProcedure.input(JoinLobbySchema).mutation(({ ctx, input }) => {
        return this.lobbyService.joinLobby(input.lobbyId, ctx.user.userId)
      }),

      get: this.trpc.protectedProcedure.input(GetLobbySchema).query(({ input }) => {
        return this.lobbyService.getLobby(input.lobbyId)
      }),

      list: this.trpc.protectedProcedure.query(() => {
        return this.lobbyService.listLobbies()
      }),

      setTeam: this.trpc.protectedProcedure.input(SetTeamSchema).mutation(({ ctx, input }) => {
        return this.lobbyService.setTeam(input.lobbyId, ctx.user.userId, input.team)
      }),

      setReady: this.trpc.protectedProcedure.input(SetReadySchema).mutation(({ ctx, input }) => {
        return this.lobbyService.setReady(input.lobbyId, ctx.user.userId, input.ready)
      }),

      start: this.trpc.protectedProcedure.input(StartMatchSchema).mutation(({ ctx, input }) => {
        return this.lobbyService.startMatch(input.lobbyId, ctx.user.userId)
      }),
    })
  }
}
