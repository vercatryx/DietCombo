// components/MapLoadingOverlay.jsx
"use client";

import React from "react";

/**
 * Map loading overlay
 * - Shows large center logo with circular loading ring
 * - Subtle animated sweep across logo for polish
 * - Transparent background (just faint gray map dimming)
 */
export default function MapLoadingOverlay({ show, logoSrc = "/logo.png" }) {
    if (!show) return null;

    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                background:
                    "linear-gradient(to bottom, rgba(240,242,245,0.8), rgba(225,228,232,0.6))",
                backdropFilter: "blur(1.5px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 2000,
                pointerEvents: "auto",
            }}
        >
            <div
                style={{
                    position: "relative",
                    width: 300, // 🔹 bigger logo area
                    height: 300,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {/* circular ring */}
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        border: "6px solid rgba(0,0,0,0.1)",
                        borderTopColor: "rgba(0,0,0,0.45)",
                        animation: "df-ring-spin 1.2s linear infinite",
                    }}
                />

                {/* Logo */}
                <img
                    src={logoSrc}
                    alt="Diet Fantasy"
                    style={{
                        width: "80%",
                        height: "auto",
                        objectFit: "contain",
                        opacity: 0.95,
                        filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.2))",
                    }}
                />

                {/* shimmer sweep */}
                <div
                    aria-hidden
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "linear-gradient(to bottom, rgba(255,255,255,0.0) 0%, rgba(255,255,255,0.25) 60%, rgba(255,255,255,0.0) 100%)",
                        backgroundSize: "100% 200%",
                        animation: "df-sweep 1.1s ease-in-out infinite",
                        mixBlendMode: "overlay",
                        pointerEvents: "none",
                    }}
                />
            </div>

            {/* Animations */}
            <style>{`
        @keyframes df-ring-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes df-sweep {
          0%   { background-position: 0% -100%; opacity: .35; }
          50%  { background-position: 0% 0%; opacity: .55; }
          100% { background-position: 0% -100%; opacity: .35; }
        }
      `}</style>
        </div>
    );
}