"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Camera, ScanLine, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type WarehouseCodeScannerProps = {
  value: string;
  onChange: (value: string) => void;
  onDetected: (value: string) => void;
  name?: string;
  label?: string;
  description?: string;
  placeholder?: string;
  compact?: boolean;
};

export function WarehouseCodeScanner({
  value,
  onChange,
  onDetected,
  name,
  label = "Codice identificativo",
  description = "Inquadra il barcode o il QR. Se la fotocamera non è disponibile puoi inserire il codice manualmente.",
  placeholder = "Scansiona oppure inserisci il codice",
  compact = false,
}: WarehouseCodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  const stop = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    readerRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  };

  const detect = (nextValue: string) => {
    const normalized = nextValue.trim();
    if (!normalized) return;
    stop();
    onChange(normalized);
    onDetected(normalized);
  };

  const start = async () => {
    if (!videoRef.current) return;
    stop();
    setCameraError(false);
    try {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (result) detect(result.getText());
      });
      controlsRef.current = controls;
      setScanning(true);
    } catch {
      setCameraError(true);
      setScanning(false);
    }
  };

  useEffect(() => () => stop(), []);

  return <div className="rounded-2xl border border-white/[.08] bg-black/20 p-3">
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/[.08] text-lime-200"><ScanLine className="size-[18px]" /></span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-200">{label}</p>
        <p className="mt-1 text-[10px] leading-5 text-slate-600">{description}</p>
      </div>
    </div>
    <div className="mt-3 flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-600" />
        <Input aria-label={label} className="h-10 border-white/10 bg-black/35 pl-9 font-mono text-xs text-slate-100 placeholder:text-slate-700" name={name} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); detect(value); } }} placeholder={placeholder} value={value} />
      </div>
      <Button className="h-10 shrink-0 bg-lime-300 px-3 text-xs font-semibold text-[#060806] hover:bg-lime-200" onClick={() => detect(value)} type="button"><ScanLine className="size-3.5" />Usa</Button>
    </div>
    <div className="mt-3 overflow-hidden rounded-xl border border-lime-300/15 bg-[#020303]">
      <video ref={videoRef} className={`w-full object-cover ${compact ? "h-28" : "h-36"} ${scanning ? "opacity-90" : "hidden"}`} autoPlay muted playsInline />
      {!scanning && <div className={`${compact ? "py-3" : "py-4"} flex items-center justify-between gap-3 px-3`}><span className="text-[10px] text-slate-600">{cameraError ? "Fotocamera non disponibile · fallback manuale attivo" : "Scanner fotocamera inattivo"}</span><Button className="h-8 border-lime-300/20 bg-lime-300/[.06] px-2.5 text-[10px] text-lime-100 hover:bg-lime-300/10" onClick={() => void start()} type="button"><Camera className="size-3.5" />Avvia camera</Button></div>}
      {scanning && <div className="flex items-center justify-between gap-3 border-t border-lime-300/10 px-3 py-2"><span className="flex items-center gap-2 text-[10px] text-lime-200"><span className="size-1.5 animate-pulse rounded-full bg-lime-300" />Inquadra QR o barcode</span><Button className="h-7 border-rose-300/20 bg-rose-300/[.05] px-2 text-[10px] text-rose-200" onClick={stop} type="button" variant="outline"><X className="size-3" />Ferma</Button></div>}
    </div>
  </div>;
}
