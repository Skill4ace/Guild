import Image from "next/image";

import guildLogo from "../../assets/faviconguild.png";

type GuildLogoBadgeProps = {
  className?: string;
  priority?: boolean;
};

export function GuildLogoBadge({
  className = "",
  priority = false,
}: GuildLogoBadgeProps) {
  return (
    <span
      className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_20px_-14px_rgba(15,23,42,0.35)] ${className}`}
    >
      <Image
        src={guildLogo}
        alt="Guild logo"
        fill
        priority={priority}
        className="object-cover"
      />
    </span>
  );
}
