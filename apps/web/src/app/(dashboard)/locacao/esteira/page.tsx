import { redirect } from "next/navigation";

// A esteira COMERCIAL de locação foi movida para o módulo Pipeline.
// Mantemos este redirect como rede de segurança para links/bookmarks antigos.
export default function LocacaoEsteiraRedirect() {
  redirect("/pipeline/locacao");
}
