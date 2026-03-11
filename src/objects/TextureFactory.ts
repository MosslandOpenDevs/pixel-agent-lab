import Phaser from "phaser";

/** Procedurally generates all pixel-art textures for the visualization. */
export function generateTextures(scene: Phaser.Scene): void {
    const gen = (key: string, data: string[], palette: Record<string, string>) =>
        scene.textures.generate(key, { pixelWidth: 2, data, palette: palette as any });

    // --- Signal orb (cyan pulsing circle) ---
    gen("signal-orb", [
        "...aa...",
        "..abba..",
        ".abccba.",
        ".abccba.",
        "..abba..",
        "...aa...",
    ], { a: "#22d3ee", b: "#67e8f9", c: "#a5f3fc", ".": "#00000000" });

    // --- Issue card (orange rectangle with ! mark) ---
    gen("issue-card", [
        "aaaaaaaaaaaa",
        "abbbbbbbbba.",
        "abccccccba..",
        "abcddddcba..",
        "abcddddcba..",
        "abccccccba..",
        "abcddddcba..",
        "abbbbbbbbba.",
        "aaaaaaaaaaaa",
    ], { a: "#f97316", b: "#fdba74", c: "#fff7ed", d: "#fed7aa", ".": "#00000000" });

    // --- Idea bubble (yellow thought bubble) ---
    gen("idea-bubble", [
        "...aaaa...",
        "..abbbba..",
        ".abccccba.",
        ".abccccba.",
        "..abbbba..",
        "...aaaa...",
        "....ab....",
        ".....a....",
    ], { a: "#eab308", b: "#facc15", c: "#fef08a", ".": "#00000000" });

    // --- Plan document (gold doc with lines) ---
    gen("plan-doc", [
        "aaaaaaaaaa..",
        "abbbbbbbba..",
        "abcccccba...",
        "abddddba....",
        "abcccccba...",
        "abddddba....",
        "abcccccba...",
        "abbbbbbbba..",
        "aaaaaaaaaa..",
    ], { a: "#d97706", b: "#f59e0b", c: "#fbbf24", d: "#fde68a", ".": "#00000000" });

    // --- Project box (amber box with gear) ---
    gen("project-box", [
        ".aaaaaaaaaa.",
        "abbbbbbbbbba",
        "abccccccccba",
        "abcdddddcba.",
        "abcdeeecba..",
        "abcdddddcba.",
        "abccccccccba",
        "abbbbbbbbbba",
        ".aaaaaaaaaa.",
    ], { a: "#92400e", b: "#b45309", c: "#d97706", d: "#f59e0b", e: "#22c55e", ".": "#00000000" });

    // --- Proposal seal (blue doc with stamp) ---
    gen("proposal-seal", [
        "aaaaaaaaaa..",
        "abbbbbbbba..",
        "abcccccba...",
        "abcccccba...",
        "abcddddba...",
        "abcdeedba...",
        "abcddddba...",
        "abbbbbbbba..",
        "aaaaaaaaaa..",
    ], { a: "#1e40af", b: "#3b82f6", c: "#93c5fd", d: "#60a5fa", e: "#dbeafe", ".": "#00000000" });

    // --- Outcome proof (green shield with check) ---
    gen("outcome-proof", [
        "...aaaa...",
        "..abbbba..",
        ".abccccba.",
        ".abcddcba.",
        ".abcdddba.",
        "..abddba..",
        "..abdbba..",
        "...abba...",
        "....aa....",
    ], { a: "#166534", b: "#22c55e", c: "#86efac", d: "#dcfce7", ".": "#00000000" });

    // --- Trust token (teal circle with star) ---
    gen("trust-token", [
        "..aa..",
        ".abba.",
        "abccba",
        "abccba",
        ".abba.",
        "..aa..",
    ], { a: "#0d9488", b: "#2dd4bf", c: "#99f6e4", ".": "#00000000" });

    // --- Star (background) ---
    gen("star", [
        "..a..",
        ".aaa.",
        "aaaaa",
        ".aaa.",
        "..a..",
    ], { a: "#ffffff", ".": "#00000000" });

    // --- Agent bots (3 service colors) ---
    const makeBot = (key: string, accent: string) => {
        gen(`${key}-0`, [
            "...wwww...",
            "..wvvvvw..",
            "..wvvvvw..",
            ".wwwwwwww.",
            ".wwwaawww.",
            ".wwwwwwww.",
            "..dd..dd..",
            "...dddd...",
        ], { w: "#e5e7eb", v: "#0f172a", a: accent, d: "#9ca3af", ".": "#00000000" });
        gen(`${key}-1`, [
            "...wwww...",
            "..wvvvvw..",
            "..wvvvvw..",
            ".wwwwwwww.",
            ".wwwaawww.",
            ".wwwwwwww.",
            "...dddd...",
            "..dd..dd..",
        ], { w: "#e5e7eb", v: "#0f172a", a: accent, d: "#9ca3af", ".": "#00000000" });
    };

    makeBot("algora-bot", "#34d399");
    makeBot("ao-bot", "#f59e0b");
    makeBot("bridge-bot", "#60a5fa");
}
