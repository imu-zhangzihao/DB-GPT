import { getCitationOriginalSource, type CitationChunkPreview } from '@/client/api/knowledge';
import type { AgentCitation } from '@/utils/react-agent-final';
import { findCitationTextRanges } from '@/utils/citation-preview';
import { Alert, Spin, Table } from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';

type MatchPrecision = 'exact' | 'approximate' | 'region' | 'unavailable';

const precisionLabel: Record<MatchPrecision, string> = {
  exact: '精确定位',
  approximate: '近似匹配',
  region: '已定位到区域',
  unavailable: '无法定位',
};

const normalizeEvidence = (value: string) => value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

const spreadsheetColumnName = (zeroBasedIndex: number) => {
  let value = zeroBasedIndex + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

const locationText = (preview: CitationChunkPreview) => {
  if (preview.sourceType === 'pdf' && preview.pageNumber) return `第 ${preview.pageNumber} 页`;
  if ((preview.sourceType === 'spreadsheet' || preview.sourceType === 'csv') && preview.startRow) {
    return `${preview.sheetName ? `${preview.sheetName} · ` : ''}第 ${preview.startRow} 行`;
  }
  if (preview.startLine) return `第 ${preview.startLine}${preview.endLine ? `–${preview.endLine}` : ''} 行`;
  return '';
};

const PrecisionBanner: React.FC<{ precision: MatchPrecision; preview: CitationChunkPreview }> = ({
  precision,
  preview,
}) => (
  <Alert
    className='mb-3'
    showIcon
    type={precision === 'unavailable' ? 'warning' : precision === 'exact' ? 'success' : 'info'}
    message={`${precisionLabel[precision]}${locationText(preview) ? ` · ${locationText(preview)}` : ''}`}
    description={
      precision === 'region'
        ? '已打开原文件并定位到来源区域，但当前索引没有足够坐标进行精确框选。'
        : precision === 'approximate'
          ? '高亮内容由引用文本与原文件文本匹配得到。'
          : undefined
    }
  />
);

const TextSourceViewer: React.FC<{
  blob: Blob;
  preview: CitationChunkPreview;
  evidence: string;
  onPrecision: (precision: MatchPrecision) => void;
}> = ({ blob, preview, evidence, onPrecision }) => {
  const [text, setText] = useState('');
  useEffect(() => {
    let active = true;
    blob.text().then(value => active && setText(value));
    return () => {
      active = false;
    };
  }, [blob]);

  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const evidenceKey = normalizeEvidence(evidence);
  const matchingLines = useMemo(() => {
    const result = new Set<number>();
    if (preview.startLine) {
      const end = preview.endLine || preview.startLine;
      for (let line = preview.startLine; line <= end; line += 1) result.add(line);
      return result;
    }
    if (!evidenceKey) return result;
    lines.forEach((line, index) => {
      const normalized = normalizeEvidence(line);
      if (normalized && (evidenceKey.includes(normalized) || normalized.includes(evidenceKey.slice(0, 80)))) {
        result.add(index + 1);
      }
    });
    return result;
  }, [evidenceKey, lines, preview.endLine, preview.startLine]);

  useEffect(() => {
    const precision = matchingLines.size ? (preview.startLine ? 'exact' : 'approximate') : 'unavailable';
    onPrecision(precision);
    const first = matchingLines.values().next().value;
    if (first)
      requestAnimationFrame(() =>
        document.getElementById(`citation-source-line-${first}`)?.scrollIntoView({ block: 'center' }),
      );
  }, [matchingLines, onPrecision, preview.startLine]);

  return (
    <div className='max-h-[62vh] overflow-auto rounded-lg border border-gray-200 bg-white font-mono text-xs dark:border-gray-700 dark:bg-[#111217]'>
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const highlighted = matchingLines.has(lineNumber);
        return (
          <div
            id={`citation-source-line-${lineNumber}`}
            key={lineNumber}
            className={`flex min-h-6 whitespace-pre-wrap break-all ${highlighted ? 'bg-yellow-200 text-gray-950 dark:bg-yellow-500/40 dark:text-white' : ''}`}
          >
            <span className='w-14 flex-none select-none border-r border-gray-200 px-2 py-1 text-right text-gray-400 dark:border-gray-700'>
              {lineNumber}
            </span>
            <span className='px-3 py-1'>{line || ' '}</span>
          </div>
        );
      })}
    </div>
  );
};

const SpreadsheetSourceViewer: React.FC<{
  blob: Blob;
  preview: CitationChunkPreview;
  evidence: string;
  onPrecision: (precision: MatchPrecision) => void;
}> = ({ blob, preview, evidence, onPrecision }) => {
  const [rows, setRows] = useState<unknown[][]>([]);
  const [sheetName, setSheetName] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellText: true });
        const selected =
          (preview.sheetName && workbook.Sheets[preview.sheetName] && preview.sheetName) || workbook.SheetNames[0];
        if (!selected) throw new Error('Workbook has no worksheets');
        const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[selected], {
          header: 1,
          raw: false,
          defval: '',
        });
        if (active) {
          setSheetName(selected);
          setRows(values);
        }
      } catch {
        if (active) setError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [blob, preview.sheetName]);

  const targetRow = preview.startRow;
  const evidenceKey = normalizeEvidence(evidence);
  const inferredRow = useMemo(() => {
    if (targetRow) return targetRow;
    const index = rows.findIndex(row => normalizeEvidence(row.join(' ')).includes(evidenceKey.slice(0, 80)));
    return index >= 0 ? index + 1 : undefined;
  }, [evidenceKey, rows, targetRow]);
  const windowedRows = useMemo(() => {
    const center = inferredRow || 1;
    const start = Math.max(1, center - 30);
    const end = Math.min(rows.length, center + 30);
    return rows.slice(start - 1, end).map((values, index) => ({ rowNumber: start + index, values }));
  }, [inferredRow, rows]);
  const columnCount = Math.min(
    50,
    rows.reduce((max, row) => Math.max(max, row.length), 0),
  );
  const columns = Array.from({ length: columnCount }, (_, index) => ({
    title: index === 0 ? `${sheetName || 'Sheet'} · A` : spreadsheetColumnName(index),
    key: String(index),
    width: 160,
    render: (_: unknown, row: { values: unknown[] }) => String(row.values[index] ?? ''),
  }));

  useEffect(() => {
    if (!rows.length) return;
    onPrecision(inferredRow ? (targetRow ? 'region' : 'approximate') : 'unavailable');
  }, [inferredRow, onPrecision, rows.length, targetRow]);

  if (error) return <Alert type='warning' showIcon message='无法解析该工作簿，仍可下载原文件查看。' />;
  if (!rows.length) return <Spin tip='正在解析原始工作簿…' />;
  return (
    <div className='max-h-[62vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700'>
      <Table
        size='small'
        pagination={false}
        scroll={{ x: Math.max(720, columnCount * 160) }}
        rowKey='rowNumber'
        columns={[
          {
            title: '#',
            dataIndex: 'rowNumber',
            key: 'rowNumber',
            fixed: 'left',
            width: 70,
          },
          ...columns,
        ]}
        dataSource={windowedRows}
        onRow={row => ({
          id: `citation-source-row-${row.rowNumber}`,
          className: row.rowNumber === inferredRow ? '!bg-yellow-200 dark:!bg-yellow-500/30' : '',
        })}
      />
    </div>
  );
};

const PdfSourceViewer: React.FC<{
  blob: Blob;
  preview: CitationChunkPreview;
  evidence: string;
  onPrecision: (precision: MatchPrecision) => void;
}> = ({ blob, preview, evidence, onPrecision }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: any;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/legacy/build/pdf.worker.min.js',
          import.meta.url,
        ).toString();
        loadingTask = pdfjs.getDocument({
          data: await blob.arrayBuffer(),
          // Uploaded PDFs are untrusted. PDF.js must not evaluate generated
          // JavaScript while interpreting embedded font programs.
          isEvalSupported: false,
        });
        const pdfDocument = await loadingTask.promise;
        const pageNumber = Math.min(Math.max(preview.pageNumber || 1, 1), pdfDocument.numPages);
        const page = await pdfDocument.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.45 });
        const canvas = canvasRef.current;
        const layer = layerRef.current;
        if (cancelled || !canvas || !layer) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        layer.style.width = `${viewport.width}px`;
        layer.style.height = `${viewport.height}px`;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        const textContent = await page.getTextContent();
        const items = textContent.items.filter((item: any) => typeof item.str === 'string');
        const evidenceKey = normalizeEvidence(evidence);
        const normalizedItems = items.map((item: any) => normalizeEvidence(item.str));
        const joined = normalizedItems.join('');
        const matchRanges = findCitationTextRanges(joined, evidenceKey);
        let cursor = 0;
        let highlighted = 0;
        layer.replaceChildren();
        items.forEach((item: any, index: number) => {
          const itemStart = cursor;
          const itemEnd = cursor + normalizedItems[index].length;
          cursor = itemEnd;
          const isMatch = matchRanges.some(range => itemEnd > range.start && itemStart < range.end);
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const span = window.document.createElement('span');
          span.textContent = item.str;
          span.style.position = 'absolute';
          span.style.left = `${transform[4]}px`;
          span.style.top = `${transform[5] - Math.max(item.height * viewport.scale, 10)}px`;
          span.style.fontSize = `${Math.max(item.height * viewport.scale, 10)}px`;
          span.style.whiteSpace = 'pre';
          span.style.color = 'transparent';
          if (isMatch) {
            highlighted += 1;
            span.style.background = 'rgba(250, 204, 21, 0.55)';
            span.style.outline = '1px solid rgba(202, 138, 4, 0.75)';
          }
          layer.appendChild(span);
        });
        if (!cancelled) {
          onPrecision(highlighted ? 'approximate' : preview.pageNumber ? 'region' : 'unavailable');
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
          onPrecision('unavailable');
        }
      }
    })();
    return () => {
      cancelled = true;
      loadingTask?.destroy?.();
    };
  }, [blob, evidence, onPrecision, preview.pageNumber]);

  if (error) return <Alert type='warning' showIcon message='PDF 页面渲染失败，可下载原文件查看。' />;
  return (
    <div className='relative max-h-[62vh] overflow-auto rounded-lg border border-gray-200 bg-gray-200 p-3 dark:border-gray-700 dark:bg-gray-900'>
      {loading && (
        <div className='flex min-h-40 items-center justify-center'>
          <Spin tip='正在渲染 PDF 原始页面…' />
        </div>
      )}
      <div className='relative mx-auto w-fit bg-white shadow'>
        <canvas ref={canvasRef} />
        <div ref={layerRef} className='pointer-events-none absolute left-0 top-0' />
      </div>
    </div>
  );
};

export const CitationOriginalViewer: React.FC<{
  citation: AgentCitation;
  preview: CitationChunkPreview;
  onBlobReady?: (blob: Blob) => void;
}> = ({ citation, preview, onBlobReady }) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [precision, setPrecision] = useState<MatchPrecision>('region');

  useEffect(() => {
    let active = true;
    setBlob(null);
    setLoadError(false);
    getCitationOriginalSource({
      space_id: citation.knowledgeSpaceId!,
      document_id: citation.documentId!,
      chunk_id: citation.chunkId!,
    })
      .then(response => {
        if (!active) return;
        setBlob(response.data);
        onBlobReady?.(response.data);
      })
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, [citation.chunkId, citation.documentId, citation.knowledgeSpaceId, onBlobReady]);

  if (loadError) return <Alert type='warning' showIcon message='原文件当前不可用。' />;
  if (!blob)
    return (
      <div className='flex min-h-40 items-center justify-center'>
        <Spin tip='正在加载原文件…' />
      </div>
    );

  const common = { blob, preview, evidence: preview.content || citation.excerpt, onPrecision: setPrecision };
  return (
    <>
      <PrecisionBanner precision={precision} preview={preview} />
      {preview.sourceType === 'pdf' ? (
        <PdfSourceViewer {...common} />
      ) : preview.sourceType === 'spreadsheet' || preview.sourceType === 'csv' ? (
        <SpreadsheetSourceViewer {...common} />
      ) : (
        <TextSourceViewer {...common} />
      )}
    </>
  );
};
