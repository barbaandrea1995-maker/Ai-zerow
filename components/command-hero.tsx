import Link from "@/components/app-link";
import Image from "next/image";
import { ArrowUpRight, BriefcaseBusiness, Plus, Radar, Sparkles } from "lucide-react";

type CommandHeroProps = {
  onNewJob: () => void;
  recordCount: number;
  statusLabel: string;
};

export function CommandHero({ onNewJob, recordCount, statusLabel }: CommandHeroProps) {
  return (
    <section className="zw-command-hero zw-page-enter" aria-labelledby="command-hero-title">
      <div className="zw-command-hero__grid" aria-hidden="true" />
      <div className="zw-command-hero__copy">
        <div className="zw-command-hero__kicker"><Radar className="size-3.5" /> CENTRALE OPERATIVA</div>
        <h1 id="command-hero-title"><span>TUTTO SOTTO CONTROLLO.</span><strong>UN PASSO AVANTI, OGNI GIORNO.</strong></h1>
        <p>Dati, persone e attività in un’unica vista operativa.</p>
        <div className="zw-command-hero__actions">
          <button className="zw-button-primary" onClick={onNewJob} type="button"><Plus className="size-4" />Nuovo lavoro</button>
          <Link className="zw-button-secondary" href="/operations"><BriefcaseBusiness className="size-4" />Apri commesse<ArrowUpRight className="size-3.5" /></Link>
          <Link className="zw-command-hero__ai-link" href="#company-ai"><Sparkles className="size-3.5" />Company AI</Link>
        </div>
      </div>

      <div className="zw-command-hero__visual" aria-hidden="true">
        <div className="zw-command-hero__orbit zw-command-hero__orbit--outer" />
        <div className="zw-command-hero__orbit zw-command-hero__orbit--inner" />
        <div className="zw-command-hero__orb">
          <Image src="/ai-zerow-icon.png" alt="" width={220} height={220} className="zw-command-hero__brand-core" priority />
          <span className="zw-command-hero__core-label">NEURAL CORE</span>
        </div>
        <span className="zw-command-hero__signal zw-command-hero__signal--one" />
        <span className="zw-command-hero__signal zw-command-hero__signal--two" />
        <span className="zw-command-hero__signal zw-command-hero__signal--three" />
      </div>

      <div className="zw-command-hero__telemetry" aria-label="Telemetria dashboard" role="status">
        <span><i />{statusLabel}</span>
        <span><strong>{recordCount}</strong> record verificati</span>
        <span>AI-ZEROW / OPERATIVO</span>
      </div>
    </section>
  );
}
