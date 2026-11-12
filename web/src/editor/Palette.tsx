import { useState } from 'react';
import type { DragEvent } from 'react';
import { LOCATION_LABEL, MEDIA_META } from './panels';
import { DRAG_MIME, SOURCE_ITEMS, STORAGE_ITEMS } from './presets';
import type { PaletteItem } from './presets';
import { useEditor } from './store';

function Item({ item }: { item: PaletteItem }) {
  const addNode = useEditor((s) => s.addNode);
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <button
      type="button"
      className="bv-pal-item"
      draggable
      onDragStart={onDragStart}
      onClick={() => addNode(item)}
      title={`Ajouter : ${item.label} (${LOCATION_LABEL[item.location]}). Cliquez ou glissez sur le diagramme.`}
    >
      <span className="bv-pal-item__icon" aria-hidden="true">
        {MEDIA_META[item.mediaType].icon}
      </span>
      <span className="bv-pal-item__text">
        <span>{item.label}</span>
        <small>{LOCATION_LABEL[item.location]}</small>
      </span>
    </button>
  );
}

export default function Palette() {
  const [open, setOpen] = useState(() => typeof matchMedia !== 'function' || matchMedia('(min-width: 900px)').matches);
  return (
    <aside className={`bv-palette${open ? ' is-open' : ''}`} aria-label="Palette d'éléments">
      <button type="button" className="bv-palette__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>Ajouter</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="bv-palette__content">
          <h2>
            Sources <kbd>N</kbd>
          </h2>
          <div className="bv-pal-list">
            {SOURCE_ITEMS.map((i) => (
              <Item key={`${i.kind}-${i.mediaType}`} item={i} />
            ))}
          </div>
          <h2>
            Supports <kbd>S</kbd>
          </h2>
          <div className="bv-pal-list">
            {STORAGE_ITEMS.map((i) => (
              <Item key={`${i.kind}-${i.mediaType}`} item={i} />
            ))}
          </div>
          <p className="bv-hint">Reliez en tirant depuis la poignée de droite d'un élément vers un support.</p>
        </div>
      )}
    </aside>
  );
}
