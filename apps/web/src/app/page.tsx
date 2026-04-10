export default function HomePage() {
  return (
    <div className="card">
      <h1>Contrato com IA (MVP)</h1>
      <p>
        Este MVP cobre upload, extração, análise por IA, mapeamento manual, chat de edição e exportação
        para PDF/DOCX.
      </p>
      <ul>
        <li>Upload do contrato base em DOCX/PDF</li>
        <li>Extração e OCR quando necessário</li>
        <li>Análise IA e mapeamento</li>
        <li>Chat para editar dados e cláusulas</li>
        <li>Exportação para PDF/DOCX</li>
      </ul>
    </div>
  );
}
