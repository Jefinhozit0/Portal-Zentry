import React from "react";

interface ZentryLogoProps {
  compact?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export const ZentryLogo: React.FC<ZentryLogoProps> = ({
  compact = false,
  size = "md",
  className = "",
}) => {
  const height = compact
    ? size === "sm" ? 32 : 38
    : size === "sm" ? 36 : size === "lg" ? 62 : size === "xl" ? 82 : 46;

  return (
    <div
      className={`zentry-brand-logo ${compact ? "is-compact" : ""} ${className}`}
      title="Zentry Soluções"
    >
      <img
        src="/zentry-logo.png"
        alt="Zentry Soluções"
        style={{
          height: `${height}px`,
          width: "auto",
          objectFit: "contain",
          display: "block",
          borderRadius: "6px",
        }}
        className="zentry-logo-img"
      />
    </div>
  );
};

export default ZentryLogo;
