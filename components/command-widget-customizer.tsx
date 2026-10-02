"use client";

import type { DragEvent, ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  LayoutDashboard,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CommandWidgetId,
  CommandWidgetLayoutItem,
  CommandWidgetPublicDefinition,
  CommandWidgetSize,
} from "@/lib/command-dashboard";

const SIZE_LABELS: Record<CommandWidgetSize, string> = {
  compact: "Compatto",
  standard: "Standard",
  wide: "Ampio",
  full: "Intera riga",
};

type CustomizerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: CommandWidgetPublicDefinition[];
  layout: CommandWidgetLayoutItem[];
  onLayoutChange: (layout: CommandWidgetLayoutItem[]) => void;
  onReset: () => void;
  onSave: () => void;
  dirty: boolean;
  saving: boolean;
};

function updateItem(
  layout: CommandWidgetLayoutItem[],
  id: CommandWidgetId,
  patch: Partial<CommandWidgetLayoutItem>,
) {
  return layout.map((item) => item.id === id ? { ...item, ...patch } : item);
}

function moveItem(layout: CommandWidgetLayoutItem[], id: CommandWidgetId, offset: number) {
  const index = layout.findIndex((item) => item.id === id);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= layout.length) return layout;
  const next = [...layout];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function CommandWidgetCustomizer({
  open,
  onOpenChange,
  catalog,
  layout,
  onLayoutChange,
  onReset,
  onSave,
  dirty,
  saving,
}: CustomizerProps) {
  const definitions = new Map(catalog.map((item) => [item.id, item]));
  const visibleCount = layout.filter((item) => item.visible).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="zw-widget-customizer max-h-[88vh] max-w-3xl overflow-hidden border-lime-300/25 p-0 text-slate-100">
        <DialogHeader className="border-b border-white/10 px-5 py-5 text-left sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-lime-300/30 bg-lime-300/10 text-lime-200 shadow-[0_0_24px_rgba(200,255,34,.12)]">
              <LayoutDashboard className="size-[18px]" />
            </span>
            <div>
              <DialogTitle className="text-base text-slate-50">Componi il tuo Command</DialogTitle>
              <DialogDescription className="mt-1 max-w-xl text-xs leading-5 text-slate-500">
                Ordine, visibilita e dimensioni vengono salvati sul tuo profilo. I widget non autorizzati non entrano mai nel catalogo.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-300/70">Widget autorizzati</p>
            <span className="rounded-full border border-lime-300/15 bg-lime-300/5 px-2.5 py-1 font-mono text-[10px] text-lime-200">
              {visibleCount}/{layout.length} visibili
            </span>
          </div>

          <div className="space-y-2">
            {layout.map((item, index) => {
              const definition = definitions.get(item.id);
              if (!definition) return null;
              return (
                <article className={`zw-widget-config-row ${item.visible ? "is-visible" : ""}`} key={item.id}>
                  <GripVertical className="size-4 shrink-0 text-slate-700" aria-hidden="true" />
                  <button
                    aria-label={item.visible ? `Nascondi ${definition.label}` : `Mostra ${definition.label}`}
                    className={`grid size-9 shrink-0 place-items-center rounded-xl border transition ${item.visible ? "border-lime-300/30 bg-lime-300/10 text-lime-200" : "border-white/10 bg-black/25 text-slate-600"}`}
                    onClick={() => onLayoutChange(updateItem(layout, item.id, { visible: !item.visible }))}
                    type="button"
                  >
                    {item.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-200">{definition.label}</p>
                    <p className="mt-1 truncate text-[10px] text-slate-600">{definition.description}</p>
                  </div>
                  <label className="hidden sm:block">
                    <span className="sr-only">Dimensione {definition.label}</span>
                    <select
                      className="h-9 min-w-[130px] rounded-lg border border-white/10 bg-black/35 px-2.5 text-[11px] text-slate-300 outline-none focus:border-lime-300/45"
                      onChange={(event) => onLayoutChange(updateItem(layout, item.id, { size: event.target.value as CommandWidgetSize }))}
                      value={item.size}
                    >
                      {definition.allowedSizes.map((size) => <option key={size} value={size}>{SIZE_LABELS[size]}</option>)}
                    </select>
                  </label>
                  <div className="flex shrink-0 items-center gap-1">
                    <button aria-label={`Sposta ${definition.label} su`} className="zw-widget-order-button" disabled={index === 0} onClick={() => onLayoutChange(moveItem(layout, item.id, -1))} type="button"><ArrowUp className="size-3.5" /></button>
                    <button aria-label={`Sposta ${definition.label} giu`} className="zw-widget-order-button" disabled={index === layout.length - 1} onClick={() => onLayoutChange(moveItem(layout, item.id, 1))} type="button"><ArrowDown className="size-3.5" /></button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-white/10 px-5 py-4 sm:px-6">
          <Button className="border-white/10 bg-transparent text-slate-400 hover:border-lime-300/25 hover:bg-lime-300/5 hover:text-lime-100" onClick={onReset} type="button" variant="outline">
            <RotateCcw className="size-3.5" />Ripristina default
          </Button>
          <Button className="bg-lime-300 text-[#060806] shadow-[0_0_22px_rgba(200,255,34,.18)] hover:bg-lime-200" disabled={!dirty || saving} onClick={onSave} type="button">
            {saving ? <span className="size-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black" /> : dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />}
            {saving ? "Salvataggio…" : dirty ? "Salva layout" : "Layout salvato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FrameProps = {
  item: CommandWidgetLayoutItem;
  label: string;
  editMode: boolean;
  children: ReactNode;
  onMove: (id: CommandWidgetId, offset: number) => void;
  onDropWidget: (source: CommandWidgetId, target: CommandWidgetId) => void;
  onDragStart: (id: CommandWidgetId) => void;
  onHide: (id: CommandWidgetId) => void;
};

export function CommandWidgetFrame({
  item,
  label,
  editMode,
  children,
  onMove,
  onDropWidget,
  onDragStart,
  onHide,
}: FrameProps) {
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const source = event.dataTransfer.getData("text/plain") as CommandWidgetId;
    if (source) onDropWidget(source, item.id);
  };

  return (
    <section
      className={`zw-widget-frame zw-widget-frame--${item.size} ${editMode ? "is-editing" : ""}`}
      data-widget-id={item.id}
      draggable={editMode}
      onDragOver={editMode ? (event) => event.preventDefault() : undefined}
      onDragStart={editMode ? (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        onDragStart(item.id);
      } : undefined}
      onDrop={editMode ? drop : undefined}
    >
      {editMode ? (
        <div className="zw-widget-frame__controls">
          <span className="zw-widget-frame__handle" title="Trascina per riordinare"><GripVertical className="size-3.5" /><span>{label}</span></span>
          <button aria-label={`Sposta ${label} indietro`} onClick={() => onMove(item.id, -1)} type="button"><ArrowUp className="size-3" /></button>
          <button aria-label={`Sposta ${label} avanti`} onClick={() => onMove(item.id, 1)} type="button"><ArrowDown className="size-3" /></button>
          <button aria-label={`Nascondi ${label}`} onClick={() => onHide(item.id)} type="button"><EyeOff className="size-3" /></button>
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function CommandPersonalizationBar({
  canCustomize,
  editMode,
  visibleCount,
  totalCount,
  saved,
  onEdit,
  onOpenCustomizer,
}: {
  canCustomize: boolean;
  editMode: boolean;
  visibleCount: number;
  totalCount: number;
  saved: boolean;
  onEdit: () => void;
  onOpenCustomizer: () => void;
}) {
  return (
    <div className="zw-personalization-bar zw-section-reveal">
      <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-lime-300/25 bg-lime-300/[0.08] text-lime-200"><LayoutDashboard className="size-4" /></span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-200">Il tuo control deck</p>
          <p className="mt-0.5 truncate text-[10px] text-slate-600">{visibleCount} di {totalCount} widget · profilo personale {saved ? "sincronizzato" : "da salvare"}</p>
        </div>
      </div>
      {canCustomize ? (
        <div className="flex items-center gap-2">
          <button className={`zw-personalization-toggle ${editMode ? "is-active" : ""}`} onClick={onEdit} type="button"><GripVertical className="size-3.5" />{editMode ? "Fine riordino" : "Riordina"}</button>
          <button className="zw-button-primary h-10" onClick={onOpenCustomizer} type="button"><SlidersHorizontal className="size-3.5" />Personalizza</button>
        </div>
      ) : (
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] text-slate-500">Layout gestito dal ruolo</span>
      )}
    </div>
  );
}
