"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  clauseWriteSchema,
  CLAUSE_GROUP_CODES,
  CLAUSE_STATUSES,
  CLAUSE_SUBCATEGORY_SUGGESTIONS,
  CLAUSE_ESTEIRA_VALUES,
  GROUP_LABELS,
  deriveIsVariable,
  type ClauseWriteInput,
} from "@/lib/clauses/schema";
import { ESTEIRA_LABEL, ESTEIRA_AXIS } from "@/lib/clauses/taxonomy";
import {
  descriptiveVocabularyFor,
  isCanonicalTag,
  areTagsFrozen,
} from "@/lib/clauses/tag-vocabulary";
import { CLAUSE_SLOT_KEYS, slotTag } from "@/lib/templates/clause-slots";
import { ClausePreviewFrame } from "./ClausePreviewFrame";
import { CLAUSE_STATUS_LABEL, type Clause } from "./types";

interface ClauseEditorProps {
  /** Cláusula em edição — ausente/null em modo `create`. */
  clause?: Clause | null;
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  /** Módulo de locação do tenant: desligado, a esteira fica travada em venda. */
  locacaoEnabled?: boolean;
  /** Tags já usadas no acervo da org — entram no autocomplete. */
  orgTags?: string[];
}

const NONE_GROUP = "none";

function defaultValuesFor(clause?: Clause | null): ClauseWriteInput {
  if (!clause) {
    return {
      title: "",
      content: "",
      subcategory: "customizada",
      groupCode: null,
      esteira: null,
      isVariable: false,
      agentNotes: "",
      tags: [],
      status: "approved",
    };
  }
  return {
    title: clause.title,
    content: clause.content,
    subcategory: clause.subcategory || clause.category || "customizada",
    // Sanitiza valor legado: o editor antigo persistia "none" (e podia haver
    // lixo) — cair cru no zodResolver tornava a linha insalvável em silêncio,
    // com o Select mascarando "none" como "Nenhum" (achado de review).
    groupCode: (CLAUSE_GROUP_CODES as readonly string[]).includes(clause.groupCode ?? "")
      ? (clause.groupCode as ClauseWriteInput["groupCode"])
      : null,
    esteira: (CLAUSE_ESTEIRA_VALUES as readonly string[]).includes(clause.esteira ?? "")
      ? (clause.esteira as ClauseWriteInput["esteira"])
      : null,
    isVariable: clause.isVariable,
    agentNotes: clause.agentNotes ?? "",
    tags: clause.tags ?? [],
    status: (clause.status as ClauseWriteInput["status"]) ?? "approved",
  };
}

/**
 * Sheet de criar/editar cláusula — RHF + `zodResolver(clauseWriteSchema)`,
 * o mesmo schema que POST/PATCH /api/clauses validam no server (fecha os
 * dois lados sem divergir). Três abas: Conteúdo, Preview (mesmo mecanismo
 * do detail — é o "linter" do editor) e Metadados.
 */
export function ClauseEditor({
  clause,
  open,
  onClose,
  mode,
  locacaoEnabled = false,
  orgTags = [],
}: ClauseEditorProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("conteudo");
  const [previewContent, setPreviewContent] = useState(clause?.content ?? "");
  const [tagInput, setTagInput] = useState("");
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const form = useForm<ClauseWriteInput>({
    resolver: zodResolver(clauseWriteSchema),
    defaultValues: defaultValuesFor(clause),
  });

  // Reidrata a cada abertura — cria zera, edita carrega o registro. Evita
  // depender só do `key` do parent pra resetar o form.
  useEffect(() => {
    if (!open) return;
    const values = defaultValuesFor(clause);
    form.reset(values);
    setPreviewContent(values.content);
    setActiveTab("conteudo");
    setTagInput("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clause?.id]);

  // Sem isto, erro num campo de aba desmontada (shadcn Tabs não usa
  // forceMount) deixava o Salvar "morto" sem feedback nenhum (achado de
  // review) — o editor antigo sempre dava toast no inválido.
  function onInvalid(errors: Record<string, unknown>) {
    const fields = Object.keys(errors);
    const conteudoFields = ["title", "content"];
    const target = fields.some((f) => conteudoFields.includes(f)) ? "conteudo" : "metadados";
    setActiveTab(target);
    const first = errors[fields[0]] as { message?: string } | undefined;
    toast.error(first?.message ?? "Corrija os campos destacados antes de salvar");
  }

  function handleTabChange(v: string) {
    setActiveTab(v);
    if (v === "preview") {
      setPreviewContent(form.getValues("content"));
    }
  }

  // `?? []` cria array novo a cada render e anularia os memos abaixo.
  const watchedTags = form.watch("tags");
  const tags = useMemo(() => watchedTags ?? [], [watchedTags]);
  const watchedContent = form.watch("content") ?? "";
  const watchedEsteira = form.watch("esteira") ?? null;

  // `isVariable` deixou de ser um toggle e virou leitura do próprio texto —
  // mesma regra do servidor (`deriveIsVariable`).
  const variaveisDetectadas = useMemo(
    () => (deriveIsVariable(watchedContent) ? watchedContent.match(/\{\{[^{}]+\}\}/g)?.length ?? 0 : 0),
    [watchedContent]
  );

  /**
   * Tags de IDENTIDADE (`slot:`, `garantia:`, `provider:`, `cobertura:`) e as
   * origens curadas têm o conjunto CONGELADO: mexer nele — inclusive
   * acrescentar — muda a identidade da cláusula e faz a próxima reingestão
   * duplicá-la em vez de arquivar a anterior.
   */
  const tagsCongeladas = areTagsFrozen({ source: clause?.source ?? null, tags });

  function addTag(raw?: string) {
    const tag = (raw ?? tagInput).trim();
    if (!tag) return;
    if (!tags.includes(tag)) {
      form.setValue("tags", [...tags, tag], { shouldDirty: true, shouldValidate: true });
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    form.setValue(
      "tags",
      tags.filter((t) => t !== tag),
      { shouldDirty: true }
    );
  }

  const slotSuggestions = CLAUSE_SLOT_KEYS.map((k) => slotTag(k)).filter(
    (t) => !tags.includes(t)
  );

  // Antes o Popover "Sugestões" oferecia UMA opção (`slot:garantia`) — não
  // havia vocabulário nenhum para escolher, o que fazia parecer que tag era
  // coisa que só o back preenchia.
  const vocabSuggestions = useMemo(
    () =>
      descriptiveVocabularyFor(
        watchedEsteira === "venda" || watchedEsteira === "locacao" || watchedEsteira === "ambas"
          ? watchedEsteira
          : "ambas"
      ).filter((d) => !tags.includes(d.tag)),
    [watchedEsteira, tags]
  );

  const orgTagSuggestions = useMemo(
    () => orgTags.filter((t) => !tags.includes(t) && !isCanonicalTag(t)).slice(0, 40),
    [orgTags, tags]
  );

  async function onSubmit(values: ClauseWriteInput) {
    const payload = {
      title: values.title,
      content: values.content,
      subcategory: values.subcategory,
      groupCode: values.groupCode ?? null,
      esteira: values.esteira ?? null,
      // O servidor deriva de qualquer forma; mandar o derivado mantém os dois
      // lados dizendo a mesma coisa.
      isVariable: deriveIsVariable(values.content),
      agentNotes: values.agentNotes?.trim() ? values.agentNotes.trim() : null,
      tags: values.tags ?? [],
      status: values.status ?? "approved",
    };

    const url = mode === "create" ? "/api/clauses" : `/api/clauses/${clause!.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao salvar cláusula");
        return;
      }
      toast.success(mode === "create" ? "Cláusula criada." : "Cláusula salva.");
      onClose();
      router.refresh();
    } catch {
      toast.error("Erro de conexão ao salvar.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-4">
          <SheetTitle>
            {mode === "create" ? "Nova cláusula" : `Editar: ${clause?.title ?? ""}`}
          </SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, onInvalid)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <Tabs
              value={activeTab}
              onValueChange={handleTabChange}
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
            >
              <TabsList className="w-fit">
                <TabsTrigger value="conteudo">Conteúdo</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="metadados">Metadados</TabsTrigger>
              </TabsList>

              <TabsContent value="conteudo" className="flex min-h-0 flex-1 flex-col">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Título</FormLabel>
                      <FormControl>
                        <Input placeholder="Título da cláusula" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem className="mt-3 flex min-h-0 flex-1 flex-col">
                      <FormLabel>Conteúdo (Handlebars)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Conteúdo da cláusula com {{variáveis}}"
                          className="min-h-[320px] flex-1 font-mono text-xs"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="preview" className="flex min-h-0 flex-1 flex-col">
                <ClausePreviewFrame content={previewContent} />
              </TabsContent>

              <TabsContent
                value="metadados"
                className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
              >
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="subcategory"
                    render={({ field }) => {
                      const hasLegacy =
                        !!field.value &&
                        !(CLAUSE_SUBCATEGORY_SUGGESTIONS as readonly string[]).includes(
                          field.value
                        );
                      return (
                        <FormItem>
                          <FormLabel>Subcategoria</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {hasLegacy && (
                                <SelectItem value={field.value}>
                                  {field.value} (atual)
                                </SelectItem>
                              )}
                              {CLAUSE_SUBCATEGORY_SUGGESTIONS.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                  <FormField
                    control={form.control}
                    name="esteira"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Esteira</FormLabel>
                        <Select
                          value={field.value ?? NONE_GROUP}
                          onValueChange={(v) => {
                            const next =
                              v === NONE_GROUP ? null : (v as ClauseWriteInput["esteira"]);
                            field.onChange(next);
                            // Grupo só existe em compra e venda; sair de lá com
                            // um Gx pendurado deixaria a cláusula num grupo que
                            // a própria esteira não exibe.
                            if (next !== "venda") form.setValue("groupCode", null);
                          }}
                          disabled={!locacaoEnabled}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Não classificada" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NONE_GROUP}>Não classificada</SelectItem>
                            {CLAUSE_ESTEIRA_VALUES.map((e) => (
                              <SelectItem key={e} value={e}>
                                {ESTEIRA_LABEL[e]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="groupCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Grupo
                          <span className="ml-1 font-normal text-muted-foreground">
                            (roteiro do CCV)
                          </span>
                        </FormLabel>
                        <Select
                          value={field.value ?? NONE_GROUP}
                          onValueChange={(v) =>
                            field.onChange(
                              v === NONE_GROUP
                                ? null
                                : (v as ClauseWriteInput["groupCode"])
                            )
                          }
                          // G1–G6 são as seis etapas de um contrato de compra e
                          // venda. Em locação o campo não se aplica.
                          disabled={watchedEsteira !== "venda"}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NONE_GROUP}>Nenhum</SelectItem>
                            {CLAUSE_GROUP_CODES.map((g) => (
                              <SelectItem key={g} value={g}>
                                {GROUP_LABELS[g] ?? g}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {watchedEsteira === "venda"
                            ? ESTEIRA_AXIS.venda.groups.find((g) => g.code === field.value)
                                ?.help ?? "As seis etapas de um contrato de compra e venda."
                            : "Só se aplica à esteira de compra e venda."}
                        </p>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {CLAUSE_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {CLAUSE_STATUS_LABEL[s] ?? s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  {/*
                    Aqui havia um Switch rotulado "Cláusula padronizada (G1–G6)"
                    que, na verdade, era `isVariable` — "tem placeholders". Dois
                    campos independentes com um nome só: a aba filtrava por
                    `isVariable && groupCode`, então cláusula criada à mão nunca
                    caía lá, e marcar o switch sem escolher grupo fazia a linha
                    sumir da partição. Agora `isVariable` é DERIVADO do conteúdo
                    (no servidor também) e isto é só leitura.
                  */}
                  <FormItem className="space-y-1 pt-6">
                    <FormLabel className="font-normal">Variáveis no texto</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      {variaveisDetectadas > 0
                        ? `${variaveisDetectadas} campo(s) preenchido(s) pelo formulário.`
                        : "Nenhuma — o texto é fixo."}
                    </p>
                  </FormItem>
                </div>

                <FormField
                  control={form.control}
                  name="agentNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Orientação para o agente IA</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Quando o agente deve usar esta cláusula"
                          className="min-h-[80px] text-xs"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-2">
                  <FormLabel>Tags</FormLabel>
                  {tagsCongeladas ? (
                    <p className="rounded border border-amber-500/40 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-500">
                      As tags desta cláusula são a chave que liga o formulário ao
                      contrato. Alterá-las quebraria a reingestão do pacote, então
                      ficam somente leitura.
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addTag();
                          }
                        }}
                        placeholder="Adicionar tag"
                      />
                      <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="outline" size="sm">
                            Sugestões
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="end">
                          <Command>
                            <CommandInput placeholder="Buscar tag..." />
                            <CommandList>
                              <CommandEmpty>Nenhuma sugestão.</CommandEmpty>
                              {vocabSuggestions.length > 0 && (
                                <CommandGroup heading="Vocabulário padrão">
                                  {vocabSuggestions.map((d) => (
                                    <CommandItem
                                      key={d.tag}
                                      value={`${d.tag} ${d.label}`}
                                      onSelect={() => {
                                        addTag(d.tag);
                                        setTagPopoverOpen(false);
                                      }}
                                    >
                                      <span className="font-mono text-xs">{d.tag}</span>
                                      <span className="ml-2 truncate text-muted-foreground">
                                        {d.label}
                                      </span>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              )}
                              {orgTagSuggestions.length > 0 && (
                                <CommandGroup heading="Já usadas nesta imobiliária">
                                  {orgTagSuggestions.map((t) => (
                                    <CommandItem
                                      key={t}
                                      onSelect={() => {
                                        addTag(t);
                                        setTagPopoverOpen(false);
                                      }}
                                    >
                                      {t}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              )}
                              {slotSuggestions.length > 0 && (
                                <CommandGroup heading="Slots de template">
                                  {slotSuggestions.map((t) => (
                                    <CommandItem
                                      key={t}
                                      onSelect={() => {
                                        addTag(t);
                                        setTagPopoverOpen(false);
                                      }}
                                    >
                                      {t}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              )}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <Button type="button" variant="outline" size="sm" onClick={() => addTag()}>
                        +
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <Badge
                        key={tag}
                        // Canônica × livre: distinção visual, sem migrar nada.
                        variant={isCanonicalTag(tag) ? "secondary" : "outline"}
                        className={tagsCongeladas ? "text-xs" : "cursor-pointer text-xs"}
                        title={isCanonicalTag(tag) ? undefined : "Tag livre (fora do vocabulário)"}
                        onClick={() => {
                          if (!tagsCongeladas) removeTag(tag);
                        }}
                      >
                        {tag}
                        {!tagsCongeladas && <X className="ml-1 h-3 w-3" />}
                      </Badge>
                    ))}
                    {tags.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        Sem tags. Elas ajudam o agente a encontrar a cláusula — use
                        as sugestões.
                      </span>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex items-center justify-end gap-2 border-t p-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                <Save className="mr-1 h-4 w-4" />
                {form.formState.isSubmitting
                  ? "Salvando..."
                  : mode === "create"
                    ? "Criar"
                    : "Salvar"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
