'use client';

import { useState } from 'react';

export default function UploadPage() {
  const [documentId, setDocumentId] = useState('');
  const [status, setStatus] = useState('');

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fileInput?.files?.[0]) return;

    const data = new FormData();
    data.append('file', fileInput.files[0]);

    setStatus('Uploading...');
    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      body: data,
      headers: {
        'x-user-id': (window as any).__USER_ID__ || ''
      }
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error || 'Upload failed');
      return;
    }
    setDocumentId(json.id);
    setStatus(`Uploaded. Document ID: ${json.id}`);
  }

  async function handleExtract() {
    if (!documentId) return;
    setStatus('Extracting...');
    const res = await fetch(`/api/documents/${documentId}/extract`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error || 'Extraction failed');
      return;
    }
    setStatus('Extraction done.');
  }

  async function handleAnalyze() {
    if (!documentId) return;
    setStatus('Analyzing...');
    const res = await fetch(`/api/documents/${documentId}/analyze`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json.error || 'Analysis failed');
      return;
    }
    setStatus(`Analysis ready. Save the JSON from /api/documents/${documentId}/analyze`);
  }

  return (
    <div className="card">
      <h1>Upload de Documento</h1>
      <form onSubmit={handleUpload}>
        <label>
          Arquivo DOCX/PDF
          <input type="file" name="file" accept=".pdf,.docx" />
        </label>
        <button type="submit">Enviar</button>
      </form>

      <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
        <button onClick={handleExtract} disabled={!documentId}>Extrair</button>
        <button onClick={handleAnalyze} disabled={!documentId}>Analisar</button>
      </div>

      <p>Status: {status}</p>
      {documentId && <p>Document ID: {documentId}</p>}
    </div>
  );
}
