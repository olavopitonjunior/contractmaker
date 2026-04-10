'use client';

import { useState } from 'react';

export default function ExportPage() {
  const [contractId, setContractId] = useState('');
  const [status, setStatus] = useState('');
  const [links, setLinks] = useState<{ pdfUrl?: string; docxUrl?: string }>({});

  async function handleExport() {
    if (!contractId) return;
    setStatus('Exportando...');
    const res = await fetch(`/api/contracts/${contractId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error || 'Erro na exportacao');
      return;
    }
    setLinks({ pdfUrl: json.pdfUrl, docxUrl: json.docxUrl });
    setStatus('Exportacao pronta.');
  }

  return (
    <div className="card">
      <h1>Exportacao</h1>
      <label>
        Contract ID
        <input value={contractId} onChange={(e) => setContractId(e.target.value)} />
      </label>
      <button onClick={handleExport}>Exportar</button>
      <p>Status: {status}</p>
      {links.pdfUrl && <p>PDF: {links.pdfUrl}</p>}
      {links.docxUrl && <p>DOCX: {links.docxUrl}</p>}
    </div>
  );
}
