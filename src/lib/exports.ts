// Helpers de exportación compartidos. Se usan desde:
//  - /dashboard/historial (accionista: sus recibos)
//  - /dashboard/libro-caja (admin: todos los recibos filtrados)
//  - /dashboard/extracto   (accionista: resumen mensual anual)
//
// Excel: ExcelJS, una hoja por "sheet" recibida. Los totales al final se
// muestran en negrita.
// PDF: jspdf + jspdf-autotable; una tabla por "section" con encabezado
// visual y marca del sistema.
//
// Ambos se cargan dinámicamente para que no entren en el bundle del primer
// render de la app (solo cuando el usuario hace clic en exportar).

export type ExportAlign = 'left' | 'center' | 'right';

export interface ExportColumn {
  header: string;
  key: string;
  width?: number; // aprox caracteres (Excel) / peso relativo (PDF)
  align?: ExportAlign;
}

// Una fila es un objeto plano; los valores ya vienen formateados por el
// caller (cop(), monthLabel(), etc.) — el helper no interpreta tipos.
export type ExportRow = Record<string, string | number | null | undefined>;

export interface ExportTotals {
  label: string; // texto en la primera columna
  values: Record<string, string | number>;
}

export interface ExportSection {
  // Para Excel es el nombre de la hoja; para PDF es el título de la
  // tabla. Debe ser único y breve.
  name: string;
  title?: string; // título descriptivo mostrado arriba (PDF)
  columns: ExportColumn[];
  rows: ExportRow[];
  totals?: ExportTotals;
}

export interface ExportMeta {
  // Encabezado del documento. Para Excel va como primeras filas con
  // merge; para PDF va como header y metadata.
  title: string;
  subtitle?: string;
  // "Generado: <fecha>" ya se agrega automáticamente.
}

function formatCellValue(v: string | number | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return v;
}

function nowFormatted(): string {
  // Fecha local del navegador — suficiente para el pie del documento.
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
}

// -----------------------------------------------------------------------------
// Excel
// -----------------------------------------------------------------------------

export async function exportToExcel(
  filename: string,
  meta: ExportMeta,
  sections: ExportSection[],
): Promise<void> {
  // Carga dinámica: ExcelJS pesa ~500KB y solo lo necesitamos al exportar.
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ahorro Familiar';
  wb.created = new Date();

  for (const section of sections) {
    // Nombres de hoja en Excel están limitados a 31 chars y no admiten []:*?/\.
    const safeName = section.name
      .replace(/[\[\]:*?/\\]/g, ' ')
      .slice(0, 31);
    const ws = wb.addWorksheet(safeName, {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    // Cabecera del documento (filas 1-3).
    ws.getCell('A1').value = meta.title;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.mergeCells(1, 1, 1, Math.max(section.columns.length, 1));

    if (meta.subtitle) {
      ws.getCell('A2').value = meta.subtitle;
      ws.getCell('A2').font = { size: 10, color: { argb: 'FF6B6B6B' } };
      ws.mergeCells(2, 1, 2, Math.max(section.columns.length, 1));
    }

    ws.getCell('A3').value = `Generado: ${nowFormatted()}`;
    ws.getCell('A3').font = { size: 9, color: { argb: 'FF9B9B9B' } };
    ws.mergeCells(3, 1, 3, Math.max(section.columns.length, 1));

    // Fila de encabezados (fila 4).
    ws.columns = section.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 18,
    }));
    // `columns` ya crea la fila 1 como header — pero como ya usamos filas
    // 1-3 para meta, movemos las columnas manualmente: en ExcelJS, setear
    // `columns` pone el header en la primera fila. Como ya pusimos meta
    // arriba, reescribimos la cabecera en la fila 4:
    const headerRow = ws.getRow(4);
    section.columns.forEach((c, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F2B4B' },
      };
      cell.alignment = {
        horizontal: c.align ?? 'left',
        vertical: 'middle',
      };
    });
    // Escondemos la fila 1 de header auto-generada por `ws.columns` si
    // quedó vacía de datos. Con ExcelJS se pisa cuando escribimos la
    // fila 4, pero limpiamos por si acaso.
    headerRow.height = 20;

    // Filas de datos (a partir de fila 5).
    section.rows.forEach((row, rIdx) => {
      const dataRow = ws.getRow(5 + rIdx);
      section.columns.forEach((c, cIdx) => {
        const cell = dataRow.getCell(cIdx + 1);
        cell.value = row[c.key] ?? '';
        cell.alignment = {
          horizontal: c.align ?? 'left',
          vertical: 'middle',
        };
        if (rIdx % 2 === 1) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF5F6FA' },
          };
        }
      });
    });

    // Totales al final.
    if (section.totals) {
      const totalsRowIdx = 5 + section.rows.length;
      const totalsRow = ws.getRow(totalsRowIdx);
      section.columns.forEach((c, cIdx) => {
        const cell = totalsRow.getCell(cIdx + 1);
        if (cIdx === 0) {
          cell.value = section.totals!.label;
        } else {
          cell.value = section.totals!.values[c.key] ?? '';
        }
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8EAF6' },
        };
        cell.alignment = {
          horizontal: c.align ?? 'left',
          vertical: 'middle',
        };
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
  );
}

// -----------------------------------------------------------------------------
// PDF
// -----------------------------------------------------------------------------

export async function exportToPdf(
  filename: string,
  meta: ExportMeta,
  sections: ExportSection[],
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const autoTableModule = await import('jspdf-autotable');
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Cabecera.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(31, 43, 75);
  doc.text(meta.title, 40, 50);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  let headerY = 68;
  if (meta.subtitle) {
    doc.text(meta.subtitle, 40, headerY);
    headerY += 14;
  }
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generado: ${nowFormatted()}`, 40, headerY);
  doc.text('Ahorro Familiar', pageWidth - 40, headerY, { align: 'right' });

  let cursorY = headerY + 18;

  sections.forEach((section, idx) => {
    if (idx > 0 && cursorY > 650) {
      doc.addPage();
      cursorY = 50;
    }

    if (section.title) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(31, 43, 75);
      doc.text(section.title, 40, cursorY);
      cursorY += 12;
    }

    const head = [section.columns.map((c) => c.header)];
    const body = section.rows.map((r) =>
      section.columns.map((c) => formatCellValue(r[c.key])),
    );

    const foot: string[][] | undefined = section.totals
      ? [
          section.columns.map((c, i) =>
            i === 0
              ? section.totals!.label
              : formatCellValue(section.totals!.values[c.key]),
          ),
        ]
      : undefined;

    const columnStyles: Record<number, { halign?: ExportAlign }> = {};
    section.columns.forEach((c, i) => {
      if (c.align) columnStyles[i] = { halign: c.align };
    });

    autoTable(doc, {
      head,
      body,
      foot,
      startY: cursorY,
      theme: 'striped',
      styles: {
        fontSize: 9,
        cellPadding: 4,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [31, 43, 75],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      footStyles: {
        fillColor: [232, 234, 246],
        textColor: [31, 43, 75],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [245, 246, 250],
      },
      columnStyles,
      margin: { left: 40, right: 40 },
      didDrawPage: () => {
        // Paginado en el pie.
        const pageCount = doc.getNumberOfPages();
        const currentPage = doc.getCurrentPageInfo().pageNumber;
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Página ${currentPage} de ${pageCount}`,
          pageWidth - 40,
          pageHeight - 20,
          { align: 'right' },
        );
      },
    });

    // lastAutoTable es añadido por el plugin al doc.
    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY: number } })
        .lastAutoTable?.finalY ?? cursorY + 20;
    cursorY = finalY + 24;
  });

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

// -----------------------------------------------------------------------------
// Util
// -----------------------------------------------------------------------------

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
