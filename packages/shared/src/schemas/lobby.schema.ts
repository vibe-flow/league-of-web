import { z } from 'zod'

export const JoinLobbySchema = z.object({
  lobbyId: z.string().min(1),
})

export const SetTeamSchema = z.object({
  lobbyId: z.string().min(1),
  team: z.enum(['blue', 'red']),
})

export const SetReadySchema = z.object({
  lobbyId: z.string().min(1),
  ready: z.boolean(),
})

export const StartMatchSchema = z.object({
  lobbyId: z.string().min(1),
})

export const GetLobbySchema = z.object({
  lobbyId: z.string().min(1),
})
