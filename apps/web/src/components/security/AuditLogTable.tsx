"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, MinusCircle, ChevronLeft, ChevronRight } from "lucide-react";

interface AuditRow {
  id: string;
  action: string;
  result: "SUCCESS" | "FAILURE" | "DENIED";
  resource: string | null;
  resourceType: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string } | null;
}

const RESULT_ICON = {
  SUCCESS: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  FAILURE: <XCircle className="h-4 w-4 text-red-600" />,
  DENIED: <MinusCircle className="h-4 w-4 text-amber-600" />,
};

export function AuditLogTable() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const [filter, setFilter] = useState({ action: "", result: "", q: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("offset", String(offset));
      params.set("limit", String(limit));
      if (filter.action) params.set("action", filter.action);
      if (filter.result) params.set("result", filter.result);
      if (filter.q.trim()) params.set("q", filter.q.trim());

      const res = await fetch(`/api/security/audit-log?${params}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setRows(data.rows);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, filter.action, filter.result, filter.q]);

  function exportUrl(): string {
    const params = new URLSearchParams();
    if (filter.action) params.set("action", filter.action);
    if (filter.result) params.set("result", filter.result);
    if (filter.q.trim()) params.set("q", filter.q.trim());
    return `/api/security/audit-log/export?${params}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display tracking-tight text-2xl font-semibold">Registro de atividade</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {total} evento{total !== 1 ? "s" : ""}
          </span>
          <Button variant="outline" size="sm" asChild>
            <a href={exportUrl()}>Exportar CSV</a>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-3">
            <Label htmlFor="f-q">Busca livre</Label>
            <Input
              id="f-q"
              placeholder="ação, recurso ou tipo de recurso…"
              value={filter.q}
              onChange={(e) => {
                setOffset(0);
                setFilter((f) => ({ ...f, q: e.target.value }));
              }}
            />
          </div>
          <div>
            <Label htmlFor="f-action">Ação</Label>
            <Input
              id="f-action"
              placeholder="ex: LOGIN_ELEVATED"
              value={filter.action}
              onChange={(e) =>
                setFilter((f) => ({ ...f, action: e.target.value }))
              }
            />
          </div>
          <div>
            <Label htmlFor="f-result">Resultado</Label>
            <select
              id="f-result"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={filter.result}
              onChange={(e) =>
                setFilter((f) => ({ ...f, result: e.target.value }))
              }
            >
              <option value="">Todos</option>
              <option value="SUCCESS">Sucesso</option>
              <option value="FAILURE">Falha</option>
              <option value="DENIED">Negado</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilter({ action: "", result: "", q: "" });
                setOffset(0);
              }}
            >
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-3 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Usuário</th>
              <th className="px-3 py-2">Ação</th>
              <th className="px-3 py-2">Resultado</th>
              <th className="px-3 py-2">Recurso</th>
              <th className="px-3 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum registro
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <>
                <tr
                  key={r.id}
                  className="border-t hover:bg-muted/50 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-2">
                    {r.user ? (
                      <Link
                        href={`/settings/seguranca/audit-log/users/${r.user.id}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                        title="Ver atividade deste usuário"
                      >
                        {r.user.name ?? r.user.email}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {RESULT_ICON[r.result]}
                      <Badge variant="outline" className="text-xs">
                        {r.result}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.resource ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {r.ipAddress ?? "—"}
                  </td>
                </tr>
                {expandedId === r.id && (
                  <tr key={`${r.id}-exp`} className="bg-muted/30">
                    <td colSpan={6} className="px-3 py-3">
                      <pre className="text-xs overflow-x-auto bg-background p-2 rounded border">
                        {JSON.stringify(r.metadata, null, 2)}
                      </pre>
                      {r.userAgent && (
                        <div className="text-xs text-muted-foreground mt-2">
                          UA: {r.userAgent}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Mostrando {offset + 1}-{Math.min(offset + limit, total)} de {total}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
