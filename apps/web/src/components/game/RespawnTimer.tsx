import type { ChampionSnapshot } from '@template-dev/shared'

interface Props {
  player: ChampionSnapshot | null
}

export default function RespawnTimer({ player }: Props) {
  if (!player || player.alive) return null

  const seconds = Math.ceil((player.respawnTimerMs ?? 0) / 1000)

  return (
    <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative rounded-xl border border-gray-600 bg-gray-900/80 px-8 py-6 text-center backdrop-blur-sm">
        <p className="text-sm text-gray-400">Vous etes mort</p>
        <p className="mt-2 text-4xl font-bold text-white">{seconds}s</p>
        <p className="mt-1 text-xs text-gray-500">Reapparition...</p>
      </div>
    </div>
  )
}
