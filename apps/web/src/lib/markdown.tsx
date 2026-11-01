import type { ReactNode } from 'react';

/** Ancla de un título: «Asistencia del día» → «asistencia-del-dia». */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** **negrita** dentro de una línea. */
function inline(text: string): ReactNode[] {
  return text.split('**').map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

/**
 * Markdown mínimo para el manual y el changelog: títulos, párrafos, listas y negrita.
 * «#» se muestra como h2, igual que «##», para que quede debajo del título de la pantalla.
 */
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{inline(para.join(' '))}</p>);
    para = [];
    if (list) {
      const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>);
      out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    }
    list = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^(#{1,4}) (.*)/);
    const li = line.match(/^(-|\d+\.) (.*)/);
    if (h) {
      flush();
      const Tag = `h${Math.max(2, h[1]!.length)}` as 'h2';
      out.push(
        <Tag key={out.length} id={slug(h[2]!)}>
          {inline(h[2]!)}
        </Tag>,
      );
    } else if (li) {
      if (para.length) flush();
      const ordered = li[1] !== '-';
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(li[2]!);
    } else if (!line.trim()) {
      flush();
    } else if (list) {
      // Línea que sigue el ítem anterior.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return <div className="md">{out}</div>;
}
