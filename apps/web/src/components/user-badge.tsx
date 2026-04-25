import Image from "next/image";

type UserBadgeProps = {
  name: string;
  image: string | null | undefined;
  isSignedIn: boolean;
};

export function UserBadge({ name, image, isSignedIn }: UserBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      {isSignedIn && image ? (
        <div className="relative shrink-0 h-8 w-8">
          <Image
            src={image}
            alt={name}
            fill
            className="rounded-full border border-orange-400/60 object-cover"
            sizes="32px"
            unoptimized
          />
          {/* CRT tint overlay */}
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: "rgba(251,146,60,0.15)",
              mixBlendMode: "overlay",
            }}
          />
        </div>
      ) : (
        <div className="shrink-0 h-8 w-8 rounded-full border border-orange-400/60 bg-orange-400/10 flex items-center justify-center">
          <span className="text-[9px] font-mono text-orange-400/70 tracking-tight select-none">
            USR
          </span>
        </div>
      )}

      <div className="flex flex-col leading-none">
        {isSignedIn ? (
          <>
            <span className="text-[10px] uppercase tracking-[0.2em] text-orange-400/50 font-mono">
              Connected as
            </span>
            <span className="text-sm font-mono text-orange-300 truncate max-w-[160px]">
              {name}
            </span>
          </>
        ) : (
          <>
            <span className="text-[10px] uppercase tracking-[0.2em] text-orange-400/50 font-mono">
              Identity
            </span>
            <span className="text-sm font-mono text-orange-400/60 tracking-widest">
              [GUEST]
            </span>
          </>
        )}
      </div>
    </div>
  );
}
