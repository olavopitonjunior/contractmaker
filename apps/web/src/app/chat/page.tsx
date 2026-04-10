'use client';

import { useState } from 'react';

export default function ChatPage() {
  const [contractId, setContractId] = useState('');
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');
  const [preview, setPreview] = useState('');

  async function handleSend() {
    if (!contractId || !message) return;
    setResponse('Enviando...');
    const res = await fetch(`/api/contracts/${contractId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const json = await res.json();
    if (!res.ok) {
      setResponse(json.error || 'Erro no chat');
      return;
    }
    setResponse(json.message || 'Atualizado');
    setPreview(json.htmlPreview || '');
  }

  return (
    <div className="card">
      <h1>Chat de Edição</h1>
      <label>
        Contract ID
        <input value={contractId} onChange={(e) => setContractId(e.target.value)} />
      </label>
      <label>
        Mensagem
        <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <button onClick={handleSend}>Enviar</button>

      <h3>Resposta</h3>
      <pre>{response}</pre>

      <h3>Preview</h3>
      <div style={{ border: '1px solid #e2ded7', padding: '12px', background: '#fffdf9' }}
        dangerouslySetInnerHTML={{ __html: preview }}
      />
    </div>
  );
}
