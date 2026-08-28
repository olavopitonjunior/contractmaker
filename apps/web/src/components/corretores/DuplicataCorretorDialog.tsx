"use client";

import { Building2, Landmark, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cadastroSemDadosBancarios } from "@/lib/forms/commissioner-receiving";
import type { CandidatoCorretor } from "@/components/forms/steps/useComissionadoRegistry";

/**
 * "É a mesma pessoa?" — a pergunta que o formulário faz quando reconhece, pelo
 * documento, e-mail ou telefone, alguém que já está no cadastro da imobiliária.
 *
 * Existe porque a criação do cadastro virou automática. Sem a pergunta, restam
 * dois caminhos ruins: criar sempre (e encher o roster de duplicatas do mesmo
 * corretor com o nome escrito de três jeitos) ou vincular sempre (e fundir duas
 * pessoas diferentes que dividem um telefone de imobiliária).
 *
 * Deliberadamente sem opção de fechar no vazio: as duas respostas levam a uma
 * ação, e um terceiro caminho "decido depois" devolveria a linha ao limbo sem
 * cadastro que este fluxo veio resolver.
 */
export function DuplicataCorretorDialog({
  candidato,
  onConfirmar,
  onNegar,
}: {
  candidato: CandidatoCorretor | null;
  /** É a mesma pessoa: vincula o cadastro e preenche o que falta. */
  onConfirmar: () => void;
  /** É outra pessoa: segue com cadastro novo. */
  onNegar: () => void;
}) {
  if (!candidato) return null;

  const ehPJ = candidato.tipoPessoa === "juridica";
  const Icone = ehPJ ? Building2 : User;
  const detalhes = [
    candidato.creci ? `CRECI ${candidato.creci}` : null,
    candidato.email,
    candidato.phone,
    candidato.doc ? `CPF/CNPJ ${candidato.doc}` : null,
  ].filter(Boolean) as string[];

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onNegar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {ehPJ ? "Imobiliária já cadastrada?" : "Corretor já cadastrado?"}
          </DialogTitle>
          <DialogDescription>
            Encontramos um cadastro com o mesmo documento, e-mail ou telefone.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Icone className="h-4 w-4 shrink-0" />
            {candidato.label}
          </p>
          {detalhes.length > 0 && (
            <p className="text-xs text-muted-foreground break-words">
              {detalhes.join(" · ")}
            </p>
          )}
          <p className="text-xs flex items-center gap-1.5 text-muted-foreground">
            <Landmark className="h-3.5 w-3.5 shrink-0" />
            {cadastroSemDadosBancarios(candidato)
              ? "Sem dados bancários no cadastro — você pode informá-los agora."
              : "Já tem dados bancários no cadastro."}
          </p>
        </div>

        <p className="text-sm">É a mesma pessoa?</p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onNegar}>
            Não, é outra
          </Button>
          <Button type="button" onClick={onConfirmar}>
            Sim, é ela
          </Button>
        </DialogFooter>

        <p className="text-xs text-muted-foreground">
          Escolhendo <strong>sim</strong>, o cadastro é vinculado e o que estiver
          faltando no formulário é preenchido a partir dele. O que você já digitou
          não é alterado.
        </p>
      </DialogContent>
    </Dialog>
  );
}
