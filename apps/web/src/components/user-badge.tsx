import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type UserBadgeProps = {
  name: string;
  image: string | null | undefined;
  isSignedIn: boolean;
};

export function UserBadge({ name, image, isSignedIn }: UserBadgeProps) {
  const hasImage = isSignedIn && Boolean(image);

  return (
    <div className="flex items-center gap-2">
      <Avatar>
        {hasImage ? (
          <>
            <AvatarImage src={image ?? undefined} alt={name} />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full bg-terminal-400/15 mix-blend-overlay"
            />
          </>
        ) : null}
        <AvatarFallback delayMs={hasImage ? 600 : undefined}>
          USR
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col leading-none">
        {isSignedIn ? (
          <>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
              Connected as
            </span>
            <span className="text-sm font-mono text-orange-300 truncate max-w-[160px]">
              {name}
            </span>
          </>
        ) : (
          <>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
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
