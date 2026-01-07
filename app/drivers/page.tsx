"use client";

import { useState, useEffect } from "react";
import { fetchDrivers, fetchStops } from "../../lib/api";
import { Truck, RefreshCw } from "lucide-react";
import SearchStops from "../../components/drivers/SearchStops";
import DriversGrid from "../../components/drivers/DriversGrid";

export default function DriversHome() {
    const [drivers, setDrivers] = useState([]);
    const [allStops, setAllStops] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(false);

    const loadData = async (showRefreshSpinner = false) => {
        if (showRefreshSpinner) setRefreshing(true);
        else setLoading(true);
        setError(false);

        try {
            // Call cleanup first to ensure data is up to date
            await fetch("/api/route/cleanup?day=all", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            }).catch(() => {}); // Silently fail if cleanup errors

            // Then fetch the cleaned data
            const [driversData, stopsData] = await Promise.all([
                fetchDrivers(),
                fetchStops()
            ]);
            setDrivers(driversData);
            setAllStops(stopsData);
        } catch (err) {
            console.error("Failed to load data:", err);
            setError(true);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    if (error) {
        return (
            <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", textAlign: "center" }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Connection Error</h1>
                    <p style={{ marginTop: 8, color: "#6b7280" }}>Failed to load routes.</p>
                    <button
                        onClick={() => loadData()}
                        style={{
                            marginTop: 16,
                            padding: "8px 16px",
                            background: "#3665F3",
                            color: "white",
                            border: "none",
                            borderRadius: 8,
                            cursor: "pointer",
                            fontWeight: 600
                        }}
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
                <div style={{ textAlign: "center" }}>
                    <div style={{
                        width: 40,
                        height: 40,
                        border: "3px solid #e5e7eb",
                        borderTopColor: "#3665F3",
                        borderRadius: "50%",
                        animation: "spin 0.8s linear infinite",
                        margin: "0 auto"
                    }} />
                    <p style={{ marginTop: 12, color: "#6b7280" }}>Loading routes...</p>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    return (
        <div className="container">
            <div className="card">
                <div className="card-content">
                    <header className="hdr">
                        <div className="hdr-badge"><Truck /></div>
                        <div style={{ flex: 1 }}>
                            <h1 className="h1">Delivery Routes</h1>
                            <p className="sub">Select your route to begin deliveries</p>
                        </div>
                        <button
                            onClick={() => loadData(true)}
                            disabled={refreshing}
                            style={{
                                padding: "10px 16px",
                                background: refreshing ? "#e5e7eb" : "#3665F3",
                                color: refreshing ? "#6b7280" : "white",
                                border: "none",
                                borderRadius: 10,
                                cursor: refreshing ? "not-allowed" : "pointer",
                                fontWeight: 600,
                                fontSize: 14,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                transition: "all 0.2s"
                            }}
                            title="Refresh routes data"
                        >
                            <RefreshCw
                                size={16}
                                style={{
                                    animation: refreshing ? "spin 0.8s linear infinite" : "none"
                                }}
                            />
                            Refresh
                        </button>
                    </header>

                    <div className="search-wrap">
                        <SearchStops allStops={allStops} drivers={drivers} themeColor="#3665F3" />
                    </div>

                    {/* Renders the route cards + signature bars */}
                    <DriversGrid drivers={drivers} allStops={allStops} />
                </div>
            </div>

            <style
                dangerouslySetInnerHTML={{
                    __html: `
:root{
  --bg:#eef2f7; --border:#e5e7eb; --muted:#6b7280; --radius:14px;
  --shadow:0 8px 22px rgba(16,24,40,.06), 0 2px 8px rgba(16,24,40,.04);
  --sigbar:#0ea5e9;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:#111;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial}
.container{width:100%;margin:0;padding:20px}
.card{position:relative;border:1px solid var(--border);background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
.card-content{padding:18px 20px}
.color-rail{position:absolute;left:0;top:0;bottom:0;width:6px;border-top-left-radius:var(--radius);border-bottom-left-radius:var(--radius)}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.flex{display:flex;align-items:center;gap:8px}
.grid{display:grid;gap:20px}
.h1{font-size:28px;font-weight:800;margin:0}
.sub{margin:.25rem 0 0;color:var(--muted)}
.bold{font-weight:800}
.muted{color:var(--muted)}
.hdr{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.hdr-badge{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#e7eefc;color:#2748d8;
  box-shadow:inset 0 0 0 1px rgba(39,72,216,.12)}
.progress{width:100%;height:10px;border-radius:999px;background:#f1f5f9;overflow:hidden}
.progress>span{display:block;height:100%;border-radius:999px;transition:width .25s ease}
.progress.sig{height:8px;background:#eef6fb}
.progress.sig>span{background:var(--sigbar)}
.search-wrap{margin-bottom:16px}
@keyframes spin { to { transform: rotate(360deg); } }
        `,
                }}
            />
        </div>
    );
}

