import { useState } from 'react'

interface ChampionPortraitProps {
  championId: number
  championName: string
  level: number
}

export default function ChampionPortrait({
  championId,
  championName,
  level,
}: ChampionPortraitProps) {
  const [imgError, setImgError] = useState(false)
  const iconUrl =
    championId > 0
      ? `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${championId}.png`
      : null

  return (
    <div className="relative flex-shrink-0" style={{ width: 56, height: 56 }}>
      {/* Portrait */}
      <div className="h-full w-full overflow-hidden rounded-lg border-2 border-yellow-900/50 bg-[#1a1a2e]">
        {iconUrl && !imgError ? (
          <img
            src={iconUrl}
            alt={championName}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1a1a2e] to-[#2a2a4e]">
            <span className="text-xl font-bold text-amber-500/60">
              {championName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Level badge */}
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-yellow-900/60 bg-[#0a0e14] px-1.5 py-0.5">
        <span className="text-[10px] font-bold tabular-nums text-amber-200">{level}</span>
      </div>
    </div>
  )
}
