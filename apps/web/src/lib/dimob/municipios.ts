/**
 * Tabela de Órgãos e Municípios (TOM) da Receita Federal — código de município
 * usado na DIMOB (campo de 4 dígitos). Fonte oficial (dados abertos RFB):
 * https://www.gov.br/receitafederal/dados/municipios.csv (baixado 2026-07-02).
 *
 * ⚠️ Este NÃO é o código IBGE de 7 dígitos — a DIMOB usa o código TOM (4 díg).
 * Cada linha do RAW: `tom|uf|nome|ibge`. Gerado por script; NÃO editar à mão.
 * 5571 municípios (inclui placeholder EXTERIOR/EX).
 */

export interface Municipio {
  /** Código do município na Tabela TOM da RFB (4 dígitos) — vai no TXT da DIMOB. */
  tom: string;
  uf: string;
  nome: string;
  /** Código IBGE de 7 dígitos (referência; não usado no TXT da DIMOB). */
  ibge: string;
}

const RAW = `
0001|RO|Guajará-Mirim|1100106
0002|RO|Alto Alegre dos Parecis|1100379
0003|RO|Porto Velho|1100205
0004|RO|Buritis|1100452
0005|RO|Ji-Paraná|1100122
0006|RO|Chupinguaia|1100924
0007|RO|Ariquemes|1100023
0008|RO|Cujubim|1100940
0009|RO|Cacoal|1100049
0010|RO|Nova União|1101435
0011|RO|Pimenta Bueno|1100189
0012|RO|Parecis|1101450
0013|RO|Vilhena|1100304
0014|RO|Pimenteiras do Oeste|1101468
0015|RO|Jaru|1100114
0016|RO|Primavera de Rondônia|1101476
0017|RO|Ouro Preto do Oeste|1100155
0018|RO|São Felipe D'Oeste|1101484
0019|RO|Presidente Médici|1100254
0020|RO|São Francisco do Guaporé|1101492
0021|RO|Costa Marques|1100080
0022|RO|Teixeirópolis|1101559
0023|RO|Colorado do Oeste|1100064
0024|RO|Vale do Anari|1101757
0025|RO|Espigão D'Oeste|1100098
0026|RR|Amajari|1400027
0027|RO|Cerejeiras|1100056
0028|RR|Cantá|1400175
0029|RO|Rolim de Moura|1100288
0030|RR|Caroebe|1400233
0031|GO|Caldazinha|5204557
0032|RR|Iracema|1400282
0033|RO|Alta Floresta D'Oeste|1100015
0034|RR|Pacaraima|1400456
0035|RO|Alvorada D'Oeste|1100346
0036|RR|Rorainópolis|1400472
0037|RO|Cabixi|1100031
0038|RR|Uiramutã|1400704
0039|RO|Machadinho D'Oeste|1100130
0040|PA|Anapu|1500859
0041|RO|Nova Brasilândia D'Oeste|1100148
0042|PA|Bannach|1501253
0043|RO|Santa Luzia D'Oeste|1100296
0044|PA|Belterra|1501451
0045|RO|São Miguel do Guaporé|1100320
0046|PA|Cachoeira do Piriá|1501956
0047|RO|Nova Mamoré|1100338
0048|PA|Canaã dos Carajás|1502152
0049|GO|Jesúpolis|5212055
0050|PA|Curuá|1502855
0051|GO|Professor Jamil|5218391
0052|PA|Floresta do Araguaia|1503044
0053|GO|Santo Antônio de Goiás|5219738
0054|PA|Marituba|1504422
0055|GO|Cocalzinho de Goiás|5205513
0056|PA|Nova Ipixuna|1504976
0057|GO|Terezópolis de Goiás|5221197
0058|PA|Piçarra|1505635
0059|GO|Uirapuru|5221577
0060|PA|Placas|1505650
0061|GO|Buritinópolis|5203962
0062|PA|Quatipuru|1506112
0063|GO|Buriti de Goiás|5203939
0064|PA|São João da Ponta|1507466
0065|GO|Guaraíta|5209291
0066|PA|Sapucaia|1507755
0067|GO|Vila Boa|5222203
0068|PA|Tracuateua|1508035
0069|GO|Inaciolândia|5209937
0070|AP|Vitória do Jari|1600808
0071|GO|Aparecida do Rio Doce|5201454
0072|TO|Aguiarnópolis|1700301
0073|GO|Chapadão do Céu|5205471
0074|TO|Bandeirantes do Tocantins|1703057
0075|GO|Perolândia|5216452
0076|TO|Barra do Ouro|1703073
0077|GO|Cidade Ocidental|5205497
0078|TO|Chapada de Areia|1704600
0079|GO|Montividiu do Norte|5213772
0080|TO|Chapada da Natividade|1705102
0081|GO|Castelândia|5205059
0082|TO|Crixás do Tocantins|1706258
0083|GO|Santo Antônio da Barra|5219712
0084|TO|Ipueiras|1709807
0085|GO|Alto Horizonte|5200555
0086|TO|Lavandeira|1712157
0087|GO|Nova Iguaçu de Goiás|5214879
0088|TO|Luzinópolis|1712454
0089|MT|Cotriguaçu|5103379
0090|TO|Monte Santo do Tocantins|1713700
0091|MT|Planalto da Serra|5106455
0092|TO|Oliveira de Fátima|1715507
0093|MT|São Pedro da Cipa|5107404
0094|TO|Pugmil|1718451
0095|MT|Pontal do Araguaia|5106653
0096|TO|Santa Rita do Tocantins|1718899
0097|MT|Querência|5107065
0098|TO|Santa Terezinha do Tocantins|1720002
0099|MT|Ribeirãozinho|5107198
0100|TO|Talismã|1720978
0101|MT|Porto Estrela|5106851
0102|TO|Tupirama|1721257
0103|MT|Nova Marilândia|5108857
0104|MA|Água Doce do Maranhão|2100154
0105|AC|Brasiléia|1200104
0106|MA|Alto Alegre do Maranhão|2100436
0107|AC|Cruzeiro do Sul|1200203
0108|MA|Alto Alegre do Pindaré|2100477
0109|AC|Mâncio Lima|1200336
0110|MA|Amapá do Maranhão|2100550
0111|MT|Nova Maringá|5108907
0112|MA|Apicum-Açu|2100832
0113|AC|Feijó|1200302
0114|MA|Araguanã|2100873
0115|MT|Santo Afonso|5107263
0116|MA|Bacabeira|2101251
0117|MT|Nova Bandeirantes|5106158
0118|MA|Bacurituba|2101350
0119|MT|Nova Monte Verde|5108956
0120|MA|Belágua|2101731
0121|MT|Nova Guarita|5108808
0122|MA|Bela Vista do Maranhão|2101772
0123|MT|Santa Carmem|5107248
0124|MA|Bernardo do Mearim|2101939
0125|MT|Tabaporã|5107941
0126|MA|Boa Vista do Gurupi|2101970
0127|MT|Alto Boa Vista|5100359
0128|MA|Bom Jesus das Selvas|2102036
0129|MT|Canabrava do Norte|5102694
0130|MA|Bom Lugar|2102077
0131|MT|Confresa|5103353
0132|MA|Brejo de Areia|2102150
0133|MT|São José do Xingu|5107354
0134|MA|Buriticupu|2102325
0135|MT|Glória D'Oeste|5103957
0136|MA|Buritirana|2102358
0137|MT|Lambari D'Oeste|5105234
0138|MA|Cachoeira Grande|2102374
0139|AC|Rio Branco|1200401
0140|MA|Campestre do Maranhão|2102556
0141|MS|Alcinópolis|5000252
0142|MA|Capinzal do Norte|2102754
0143|MS|Nova Alvorada do Sul|5006002
0144|MA|Central do Maranhão|2103125
0145|AC|Sena Madureira|1200500
0146|MA|Centro do Guilherme|2103158
0147|AC|Tarauacá|1200609
0148|MA|Centro Novo do Maranhão|2103174
0149|AC|Xapuri|1200708
0150|MA|Cidelândia|2103257
0151|AC|Plácido de Castro|1200385
0152|MA|Conceição do Lago-Açu|2103554
0153|AC|Senador Guiomard|1200450
0154|MA|Davinópolis|2103752
0155|AC|Manoel Urbano|1200344
0156|MA|Feira Nova do Maranhão|2104073
0157|AC|Assis Brasil|1200054
0158|MA|Fernando Falcão|2104081
0159|MS|Novo Horizonte do Sul|5006259
0160|MA|Formosa da Serra Negra|2104099
0161|MS|Japorã|5004809
0162|MA|Governador Edison Lobão|2104552
0163|MS|Laguna Carapã|5005251
0164|MA|Governador Luiz Rocha|2104628
0165|TO|Angico|1701051
0166|MA|Governador Newton Bello|2104651
0167|TO|Aragominas|1701309
0168|MA|Governador Nunes Freire|2104677
0169|TO|Araguanã|1702158
0170|MA|Igarapé do Meio|2105153
0171|TO|Cachoeirinha|1703826
0172|MA|Itaipava do Grajaú|2105351
0173|TO|Campos Lindos|1703842
0174|MA|Itinga do Maranhão|2105427
0175|TO|Carmolândia|1703883
0176|MA|Jatobá|2105450
0177|TO|Carrasco Bonito|1703891
0178|MA|Jenipapo dos Vieiras|2105476
0179|TO|Darcinópolis|1706506
0180|MA|Junco do Maranhão|2105658
0181|TO|Esperantina|1707405
0182|MA|Lagoa do Mato|2105922
0183|TO|Maurilândia do Tocantins|1712801
0184|MA|Lago dos Rodrigues|2105948
0185|TO|Palmeiras do Tocantins|1713809
0186|MA|Lagoa Grande do Maranhão|2105963
0187|TO|Muricilândia|1713957
0188|MA|Lajeado Novo|2105989
0189|TO|Palmeirante|1715705
0190|MA|Maracaçumé|2106326
0191|TO|Pau D'Arco|1716307
0192|MA|Marajá do Sena|2106359
0193|TO|Riachinho|1718550
0194|MA|Maranhãozinho|2106375
0195|TO|Santa Fé do Araguaia|1718865
0196|MA|Matões do Norte|2106631
0197|TO|São Bento do Tocantins|1720101
0198|MA|Milagres do Maranhão|2106672
0199|TO|São Miguel do Tocantins|1720200
0200|MA|Nova Colinas|2107258
0201|AM|Novo Airão|1303205
0202|MA|Nova Olinda do Maranhão|2107357
0203|AM|Anori|1300102
0204|MA|Olinda Nova do Maranhão|2107456
0205|AM|Atalaia do Norte|1300201
0206|MA|Paulino Neves|2108058
0207|AM|Autazes|1300300
0208|MA|Pedro do Rosário|2108256
0209|AM|Barcelos|1300409
0210|MA|Peritoró|2108454
0211|AM|Barreirinha|1300508
0212|MA|Porto Rico do Maranhão|2109056
0213|AM|Benjamin Constant|1300607
0214|MA|Presidente Médici|2109239
0215|AM|Boca do Acre|1300706
0216|MA|Presidente Sarney|2109270
0217|AM|Borba|1300805
0218|MA|Raposa|2109452
0219|AM|Canutama|1300904
0220|MA|Ribamar Fiquene|2109551
0221|AM|Carauari|1301001
0222|MA|Santa Filomena do Maranhão|2109759
0223|AM|Careiro|1301100
0224|MA|Santana do Maranhão|2110237
0225|AM|Coari|1301209
0226|MA|Santo Amaro do Maranhão|2110278
0227|AM|Codajás|1301308
0228|MA|São Domingos do Azeitão|2110658
0229|AM|Eirunepé|1301407
0230|MA|São Francisco do Brejão|2110856
0231|AM|Envira|1301506
0232|MA|São João do Carú|2111029
0233|AM|Fonte Boa|1301605
0234|MA|São João do Paraíso|2111052
0235|AM|Humaitá|1301704
0236|MA|São João do Soter|2111078
0237|AM|Santa Isabel do Rio Negro|1303601
0238|MA|São José dos Basílios|2111250
0239|AM|Ipixuna|1301803
0240|MA|São Pedro da Água Branca|2111532
0241|AM|Itacoatiara|1301902
0242|MA|São Pedro dos Crentes|2111573
0243|AM|Itapiranga|1302009
0244|MA|São Raimundo do Doca Bezerra|2111631
0245|AM|Japurá|1302108
0246|MA|São Roberto|2111672
0247|AM|Juruá|1302207
0248|MA|Satubinha|2111722
0249|AM|Jutaí|1302306
0250|MA|Senador Alexandre Costa|2111748
0251|AM|Lábrea|1302405
0252|MA|Senador La Rocque|2111763
0253|AM|Manacapuru|1302504
0254|MA|Serrano do Maranhão|2111789
0255|AM|Manaus|1302603
0256|MA|Sucupira do Riachão|2111953
0257|AM|Manicoré|1302702
0258|MA|Trizidela do Vale|2112233
0259|AM|Maraã|1302801
0260|MA|Tufilândia|2112274
0261|AM|Maués|1302900
0262|MA|Turilândia|2112456
0263|AM|Nhamundá|1303007
0264|MA|Vila Nova dos Martírios|2112852
0265|AM|Nova Olinda do Norte|1303106
0266|PI|Acauã|2200053
0267|AM|Novo Aripuanã|1303304
0268|PI|Alvorada do Gurguéia|2200459
0269|AM|Parintins|1303403
0270|PI|Assunção do Piauí|2201051
0271|AM|Pauini|1303502
0272|PI|Barra D'Alcântara|2201176
0273|AM|Santo Antônio do Içá|1303700
0274|PI|Bela Vista do Piauí|2201556
0275|AM|São Paulo de Olivença|1303908
0276|PI|Belém do Piauí|2201572
0277|AM|Silves|1304005
0278|PI|Betânia do Piauí|2201739
0279|AM|Tapauá|1304104
0280|PI|Boa Hora|2201770
0281|AM|Tefé|1304203
0282|PI|Boqueirão do Piauí|2201945
0283|AM|São Gabriel da Cachoeira|1303809
0284|PI|Brejo do Piauí|2201988
0285|AM|Urucará|1304302
0286|PI|Cajazeiras do Piauí|2202075
0287|AM|Urucurituba|1304401
0288|PI|Cajueiro da Praia|2202083
0289|AM|Alvarães|1300029
0290|PI|Campo Alegre do Fidalgo|2202117
0291|AM|Amaturá|1300060
0292|PI|Campo Grande do Piauí|2202133
0293|AM|Anamã|1300086
0294|PI|Campo Largo do Piauí|2202174
0295|AM|Beruri|1300631
0296|PI|Capitão Gervásio Oliveira|2202455
0297|AM|Boa Vista do Ramos|1300680
0298|PI|Caraúbas do Piauí|2202539
0299|AM|Caapiranga|1300839
0300|PI|Caridade do Piauí|2202554
0301|RR|Boa Vista|1400100
0302|PI|Caxingó|2202653
0303|RR|Caracaraí|1400209
0304|PI|Cocal de Telha|2202711
0305|RR|Alto Alegre|1400050
0306|PI|Cocal dos Alves|2202729
0307|RR|Bonfim|1400159
0308|PI|Currais|2203230
0309|RR|Mucajaí|1400308
0310|PI|Curralinhos|2203255
0311|RR|Normandia|1400407
0312|PI|Curral Novo do Piauí|2203271
0313|RR|São João da Baliza|1400506
0314|PI|Floresta do Piauí|2203859
0315|RR|São Luiz|1400605
0316|PI|Francisco Macedo|2204154
0317|TO|Mateiros|1712702
0318|PI|Geminiano|2204352
0320|PI|Guaribas|2204550
0321|TO|Novo Jardim|1715259
0322|PI|Ilha Grande|2204659
0323|TO|Rio da Conceição|1718659
0324|PI|Jatobá do Piauí|2205276
0325|TO|Taipas do Tocantins|1720937
0326|PI|João Costa|2205359
0327|TO|Cariri do Tocantins|1703867
0328|PI|Joca Marques|2205458
0329|TO|Jaú do Tocantins|1711506
0330|PI|Juazeiro do Piauí|2205516
0331|TO|Sandolândia|1718840
0332|PI|Júlio Borges|2205524
0333|TO|São Salvador do Tocantins|1720259
0334|PI|Jurema|2205532
0335|TO|Sucupira|1720853
0336|PI|Lagoinha do Piauí|2205540
0337|TO|Abreulândia|1700251
0338|PI|Lagoa de São Francisco|2205573
0339|TO|Brasilândia do Tocantins|1703602
0340|PI|Lagoa do Piauí|2205581
0341|TO|Bom Jesus do Tocantins|1703305
0342|PI|Lagoa do Sítio|2205599
0343|TO|Centenário|1704105
0344|PI|Madeiro|2205854
0345|TO|Tabocão|1708254
0346|PI|Massapê do Piauí|2206050
0347|TO|Itapiratins|1710904
0348|PI|Milton Brandão|2206357
0349|TO|Juarina|1711803
0350|PI|Morro Cabeça no Tempo|2206654
0351|TO|Lajeado|1712009
0352|PI|Morro do Chapéu do Piauí|2206670
0353|TO|Lagoa do Tocantins|1711951
0354|PI|Murici dos Portelas|2206696
0355|TO|Piraquê|1717206
0356|PI|Nossa Senhora de Nazaré|2206753
0357|TO|Recursolândia|1718501
0358|PI|Novo Santo Antônio|2206951
0359|TO|Rio dos Bois|1718709
0360|PI|Olho D'Água do Piauí|2207108
0361|TO|Santa Maria do Tocantins|1718881
0362|PI|Pajeú do Piauí|2207355
0363|TO|São Félix do Tocantins|1720150
0364|PI|Paquetá|2207553
0365|TO|Tupiratins|1721307
0366|PI|Pavussu|2207850
0367|TO|Lagoa da Confusão|1711902
0368|PI|Pedro Laurentino|2207934
0369|PA|Santa Bárbara do Pará|1506351
0370|PI|Nova Santa Rita|2207959
0371|PA|Santa Luzia do Pará|1506559
0372|PI|Porto Alegre do Piauí|2208551
0373|PA|Terra Alta|1507961
0374|PI|Riacho Frio|2208858
0375|PA|Abel Figueiredo|1500131
0376|PI|Ribeira do Piauí|2208874
0377|PA|Eldorado do Carajás|1502954
0378|PI|Santo Antônio dos Milagres|2209450
0379|PA|Palestina do Pará|1505494
0380|PI|São Francisco de Assis do Piauí|2209658
0381|PA|São Domingos do Araguaia|1507151
0382|PI|São Gonçalo do Gurguéia|2209757
0383|PA|Água Azul do Norte|1500347
0384|PI|São João da Fronteira|2209872
0385|PA|Cumaru do Norte|1502764
0386|PI|São João da Varjota|2209955
0387|PA|Pau D'Arco|1505551
0388|PI|São João do Arraial|2209971
0389|PA|Aurora do Pará|1500958
0390|PI|São Luis do Piauí|2210375
0391|PA|Nova Esperança do Piriá|1504950
0392|PI|São Miguel da Baixa Grande|2210383
0393|PA|São João de Pirabas|1507474
0394|PI|São Miguel do Fidalgo|2210391
0395|PA|Tailândia|1507953
0396|PI|Sebastião Barros|2210623
0397|PA|Tucumã|1508084
0398|PI|Sebastião Leal|2210631
0399|PA|Uruará|1508159
0400|PI|Sussuapara|2210938
0401|PA|Abaetetuba|1500107
0402|PI|Tamboril do Piauí|2210953
0403|PA|Acará|1500206
0404|PI|Tanque do Piauí|2210979
0405|PA|Afuá|1500305
0406|PI|Vera Mendes|2211506
0407|PA|Alenquer|1500404
0408|PI|Vila Nova do Piauí|2211605
0409|PA|Almeirim|1500503
0410|PI|Wall Ferraz|2211704
0411|PA|Altamira|1500602
0412|RN|Bodó|2401651
0413|PA|Anajás|1500701
0414|RN|Caiçara do Norte|2401859
0415|PA|Ananindeua|1500800
0416|RN|Fernando Pedroza|2403756
0417|PA|Augusto Corrêa|1500909
0418|RN|Itajá|2404853
0419|PA|Aveiro|1501006
0420|RN|Major Sales|2407252
0421|PA|Bagre|1501105
0422|RN|Rio do Fogo|2408953
0423|PA|Baião|1501204
0424|RN|Santa Maria|2409332
0425|PA|Barcarena|1501303
0426|RN|Porto do Mangue|2410256
0427|PA|Belém|1501402
0428|RN|Tibau|2411056
0429|PA|Benevides|1501501
0430|RN|São Miguel do Gostoso|2412559
0431|PA|Bonito|1501600
0432|RN|Serrinha dos Pintos|2413557
0433|PA|Bragança|1501709
0434|RN|Tenente Laurentino Cruz|2414159
0435|PA|Breves|1501808
0436|RN|Triunfo Potiguar|2414456
0437|PA|Bujaru|1501907
0438|RN|Venha-Ver|2414753
0439|PA|Cachoeira do Arari|1502004
0440|PB|Alcantil|2500536
0441|PA|Cametá|1502103
0442|PB|Algodão de Jandaíra|2500577
0443|PA|Capanema|1502202
0444|PB|Amparo|2500734
0445|PA|Capitão Poço|1502301
0446|PB|Aparecida|2500775
0447|PA|Castanhal|1502400
0448|PB|Areia de Baraúnas|2501153
0449|PA|Chaves|1502509
0450|PB|Assunção|2501351
0451|PA|Colares|1502608
0452|PB|Baraúna|2501534
0453|PA|Conceição do Araguaia|1502707
0454|PB|Barra de Santana|2501575
0455|PA|Curralinho|1502806
0456|PB|Bernardino Batista|2502052
0457|PA|Curuçá|1502905
0458|PB|Boa Vista|2502151
0459|PA|Faro|1503002
0460|PB|Cacimbas|2503555
0461|PA|Gurupá|1503101
0462|PB|Cajazeirinhas|2503753
0463|PA|Igarapé-Açu|1503200
0464|PB|Capim|2504033
0465|PA|Igarapé-Miri|1503309
0466|PB|Caraúbas|2504074
0467|PA|Inhangapi|1503408
0468|PB|Casserengue|2504157
0469|PA|Irituia|1503507
0470|PB|Caturité|2504355
0471|PA|Itaituba|1503606
0472|PB|Coxixola|2504850
0473|PA|Itupiranga|1503705
0474|PB|Cuité de Mamanguape|2505238
0475|PA|Jacundá|1503804
0476|PB|Curral de Cima|2505279
0477|PA|Juruti|1503903
0478|PB|Damião|2505352
0479|PA|Limoeiro do Ajuru|1504000
0480|PB|Gado Bravo|2506251
0481|PA|Magalhães Barata|1504109
0482|PB|Logradouro|2508554
0483|PA|Marabá|1504208
0484|PB|Marcação|2509057
0485|PA|Maracanã|1504307
0486|PB|Marizópolis|2509156
0487|PA|Marapanim|1504406
0488|PB|Matinhas|2509339
0489|PA|Melgaço|1504505
0490|PB|Mato Grosso|2509370
0491|PA|Mocajuba|1504604
0492|PB|Maturéia|2509396
0493|PA|Moju|1504703
0494|PB|Parari|2510659
0495|PA|Monte Alegre|1504802
0496|PB|Poço Dantas|2512036
0497|PA|Muaná|1504901
0498|PB|Poço de José de Moura|2512077
0499|PA|Nova Timboteua|1505007
0500|PB|Pedro Régis|2512721
0501|PA|Óbidos|1505106
0502|PB|Riachão|2512747
0503|PA|Oeiras do Pará|1505205
0504|PB|Riachão do Bacamarte|2512754
0505|PA|Oriximiná|1505304
0506|PB|Riachão do Poço|2512762
0507|PA|Ourém|1505403
0508|PB|Riacho de Santo Antônio|2512788
0509|PA|Paragominas|1505502
0510|PB|Santa Cecília|2513158
0511|PA|Peixe-Boi|1505601
0512|PB|Santa Inês|2513356
0513|PA|Ponta de Pedras|1505700
0514|PB|Joca Claudino|2513653
0515|PA|Portel|1505809
0516|PB|Santo André|2513851
0517|PA|Porto de Moz|1505908
0518|PB|São Bentinho|2513927
0519|PA|Prainha|1506005
0520|PB|São Domingos do Cariri|2513943
0521|PA|Primavera|1506104
0522|PB|São Domingos|2513968
0523|PA|Salinópolis|1506203
0524|PB|São Francisco|2513984
0525|PA|Salvaterra|1506302
0526|PB|São José dos Ramos|2514453
0527|PA|Santa Cruz do Arari|1506401
0528|PB|São José de Princesa|2514552
0529|PA|Santa Izabel do Pará|1506500
0530|PB|São José do Brejo do Cruz|2514651
0531|PA|Santa Maria do Pará|1506609
0532|PB|Sertãozinho|2515930
0533|PA|Santana do Araguaia|1506708
0534|PB|Sobrado|2515971
0535|PA|Santarém|1506807
0536|PB|Sossêgo|2516151
0537|PA|Santarém Novo|1506906
0538|PB|Tenório|2516755
0539|PA|Santo Antônio do Tauá|1507003
0540|PB|Vieirópolis|2517209
0541|PA|São Caetano de Odivelas|1507102
0542|PB|Zabelê|2517407
0543|PA|São Domingos do Capim|1507201
0544|PE|Araçoiaba|2601052
0545|PA|São Félix do Xingu|1507300
0546|PE|Casinhas|2604155
0547|PA|São Francisco do Pará|1507409
0548|PE|Jaqueira|2607950
0549|PA|São João do Araguaia|1507508
0550|PE|Jatobá|2608057
0551|PA|São Miguel do Guamá|1507607
0552|PE|Lagoa Grande|2608750
0553|PA|São Sebastião da Boa Vista|1507706
0554|PE|Manari|2609154
0555|PA|Senador José Porfírio|1507805
0556|PE|Santa Filomena|2612554
0557|PA|Soure|1507904
0558|PE|Tamandaré|2614857
0559|PA|Tomé-Açu|1508001
0560|AL|Campestre|2701357
0561|PA|Tucuruí|1508100
0562|AL|Jequiá da Praia|2703759
0563|PA|Vigia|1508209
0564|MG|Alto Caparaó|3102050
0565|PA|Viseu|1508308
0566|MG|Angelândia|3102852
0567|PA|Redenção|1506138
0568|MG|Aricanduva|3104452
0569|PA|Rio Maria|1506161
0570|MG|Berizal|3106655
0571|PA|Xinguara|1508407
0572|MG|Bonito de Minas|3108255
0573|PA|Rondon do Pará|1506187
0574|MG|Brasilândia de Minas|3108552
0575|PA|Bom Jesus do Tocantins|1501576
0576|MG|Bugre|3109253
0577|PA|Brejo Grande do Araguaia|1501758
0578|MG|Cabeceira Grande|3109451
0579|PA|Concórdia do Pará|1502756
0580|MG|Campo Azul|3111150
0581|PA|Curionópolis|1502772
0582|MG|Cantagalo|3112059
0583|PA|Dom Eliseu|1502939
0584|MG|Catas Altas|3115359
0585|PA|Garrafão do Norte|1503077
0586|MG|Catuti|3115474
0587|PA|Mãe do Rio|1504059
0588|MG|Chapada Gaúcha|3116159
0589|PA|Medicilândia|1504455
0590|MG|Cônego Marinho|3117836
0591|PA|Ourilândia do Norte|1505437
0592|MG|Confins|3117876
0593|PA|Pacajá|1505486
0594|MG|Córrego Fundo|3119955
0595|PA|Parauapebas|1505536
0596|MG|Crisólita|3120151
0597|PA|Rurópolis|1506195
0598|MG|Cuparaque|3120839
0599|PA|Santa Maria das Barreiras|1506583
0600|MG|Curral de Dentro|3120870
0601|AP|Amapá|1600105
0602|MG|Delta|3121258
0603|AP|Calçoene|1600204
0604|MG|Divisa Alegre|3122355
0605|AP|Macapá|1600303
0606|MG|Dom Bosco|3122470
0607|AP|Mazagão|1600402
0608|MG|Franciscópolis|3126752
0609|AP|Oiapoque|1600501
0610|MG|Frei Lagonegro|3126950
0611|AP|Ferreira Gomes|1600238
0612|MG|Fruta de Leite|3127073
0613|AP|Laranjal do Jari|1600279
0614|MG|Gameleiras|3127339
0615|AP|Santana|1600600
0616|MG|Glaucilândia|3127354
0617|AP|Tartarugalzinho|1600709
0618|MG|Goiabeira|3127370
0619|PA|São Geraldo do Araguaia|1507458
0620|MG|Goianá|3127388
0621|PA|Ipixuna do Pará|1503457
0622|MG|Guaraciama|3128253
0623|PA|Ulianópolis|1508126
0624|MG|Ibiracatu|3129657
0625|PA|Breu Branco|1501782
0626|MG|Imbé de Minas|3130556
0627|PA|Goianésia do Pará|1503093
0628|MG|Indaiabira|3130655
0629|PA|Novo Repartimento|1505064
0630|MG|Japonvar|3135357
0631|PA|Jacareacanga|1503754
0632|MG|Jenipapo de Minas|3135456
0633|PA|Novo Progresso|1505031
0634|MG|José Gonçalves de Minas|3136520
0635|PA|Trairão|1508050
0636|MG|José Raydan|3136553
0637|PA|Terra Santa|1507979
0638|MG|Josenópolis|3136579
0639|PA|Brasil Novo|1501725
0640|MG|Juvenília|3136959
0641|PA|Vitória do Xingu|1508357
0642|MG|Leme do Prado|3138351
0643|AC|Acrelândia|1200013
0644|MG|Luisburgo|3138674
0645|AC|Bujari|1200138
0646|MG|Luislândia|3138682
0647|AC|Capixaba|1200179
0648|MG|Mário Campos|3140159
0649|AC|Porto Acre|1200807
0650|MG|Martins Soares|3140530
0651|AC|Epitaciolândia|1200252
0652|MG|Miravânia|3142254
0653|AC|Jordão|1200328
0654|MG|Monte Formoso|3143153
0655|AC|Marechal Thaumaturgo|1200351
0656|MG|Naque|3144359
0657|AC|Porto Walter|1200393
0658|MG|Natalândia|3144375
0659|AC|Rodrigues Alves|1200427
0660|MG|Ninheira|3144656
0661|AC|Santa Rosa do Purus|1200435
0662|MG|Nova Belém|3144672
0663|AP|Pedra Branca do Amapari|1600154
0664|MG|Nova Porteirinha|3145059
0665|AP|Serra do Navio|1600055
0666|MG|Novo Oriente de Minas|3145356
0667|AP|Cutias|1600212
0668|MG|Novorizonte|3145372
0669|AP|Itaubal|1600253
0670|MG|Olhos-d'Água|3145455
0671|AP|Porto Grande|1600535
0672|MG|Oratórios|3145851
0673|AP|Pracuúba|1600550
0674|MG|Orizânia|3145877
0675|RO|Alto Paraíso|1100403
0676|MG|Padre Carvalho|3146255
0677|RO|Cacaulândia|1100601
0678|MG|Pai Pedro|3146552
0679|RO|Campo Novo de Rondônia|1100700
0680|MG|Patis|3147956
0681|RO|Candeias do Jamari|1100809
0682|MG|Pedra Bonita|3148756
0683|RO|Itapuã do Oeste|1101104
0684|MG|Periquito|3149952
0685|RO|Monte Negro|1101401
0686|MG|Piedade de Caratinga|3150158
0687|RO|Rio Crespo|1100262
0688|MG|Pingo-d'Água|3150539
0689|RO|Novo Horizonte do Oeste|1100502
0690|MG|Pintópolis|3150570
0691|RO|Castanheiras|1100908
0692|MG|Ponto Chique|3152131
0693|RO|Governador Jorge Teixeira|1101005
0694|MG|Ponto dos Volantes|3152170
0695|RO|Ministro Andreazza|1101203
0696|MG|Reduto|3154150
0697|RO|Mirante da Serra|1101302
0698|MG|Rosário da Limeira|3156452
0699|RO|Seringueiras|1101500
0700|MG|Santa Bárbara do Monte Verde|3157278
0701|MA|Afonso Cunha|2100105
0702|MG|Santa Cruz de Minas|3157336
0703|MA|Alcântara|2100204
0704|MG|Santa Cruz de Salinas|3157377
0705|MA|Aldeias Altas|2100303
0706|MG|Santa Helena de Minas|3157658
0707|MA|Altamira do Maranhão|2100402
0708|MG|Santo Antônio do Retiro|3160454
0709|MA|Alto Parnaíba|2100501
0710|MG|São Domingos das Dores|3160959
0711|MA|Amarante do Maranhão|2100600
0712|MG|São Félix de Minas|3161056
0713|MA|Anajatuba|2100709
0714|MG|São Geraldo do Baixio|3161650
0715|MA|Anapurus|2100808
0716|MG|São João da Lagoa|3162252
0717|MA|Araioses|2100907
0718|MG|São João das Missões|3162450
0719|MA|Arari|2101004
0720|MG|São João do Pacuí|3162658
0721|MA|Axixá|2101103
0722|MG|São Joaquim de Bicas|3162922
0723|MA|Bacabal|2101202
0724|MG|São José da Barra|3162948
0725|MA|Bacuri|2101301
0726|MG|São Sebastião da Vargem Alegre|3164431
0727|MA|Balsas|2101400
0728|MG|São Sebastião do Anta|3164472
0729|MA|Barão de Grajaú|2101509
0730|MG|Sarzedo|3165537
0731|MA|Barra do Corda|2101608
0732|MG|Setubinha|3165552
0733|MA|Barreirinhas|2101707
0734|MG|Sem-Peixe|3165560
0735|MA|Benedito Leite|2101806
0736|MG|Serranópolis de Minas|3166956
0737|MA|Bequimão|2101905
0738|MG|Taparuba|3168051
0739|MA|Brejo|2102101
0740|MG|Tocos do Moji|3169059
0741|MA|Buriti|2102200
0742|MG|União de Minas|3170438
0743|MA|Buriti Bravo|2102309
0744|MG|Uruana de Minas|3170479
0745|MA|Cajapió|2102408
0746|MG|Vargem Alegre|3170578
0747|MA|Cajari|2102507
0748|MG|Vargem Grande do Rio Pardo|3170651
0749|MA|Cândido Mendes|2102606
0750|MG|Varjão de Minas|3170750
0751|MA|Cantanhede|2102705
0752|MG|Verdelândia|3171030
0753|MA|Carolina|2102804
0754|MG|Veredinha|3171071
0755|MA|Carutapera|2102903
0756|MG|Vermelho Novo|3171154
0757|MA|Caxias|2103000
0758|ES|Brejetuba|3201159
0759|MA|Cedral|2103109
0760|ES|Marataízes|3203320
0761|MA|Chapadinha|2103208
0762|ES|Ponto Belo|3204252
0763|MA|Codó|2103307
0764|ES|São Roque do Canaã|3204955
0765|MA|Coelho Neto|2103406
0766|ES|Sooretama|3205010
0767|MA|Colinas|2103505
0768|ES|Vila Valério|3205176
0769|MA|Coroatá|2103604
0770|RJ|Armação dos Búzios|3300233
0771|MA|Cururupu|2103703
0772|RJ|Carapebus|3300936
0773|MA|Dom Pedro|2103802
0774|RJ|Iguaba Grande|3301876
0775|MA|Duque Bacelar|2103901
0776|RJ|Macuco|3302452
0777|MA|Esperantinópolis|2104008
0778|RJ|Pinheiral|3303955
0779|MA|Fortaleza dos Nogueiras|2104107
0780|RJ|Porto Real|3304110
0781|MA|Fortuna|2104206
0782|RJ|São Francisco de Itabapoana|3304755
0783|MA|Godofredo Viana|2104305
0784|RJ|São José de Ubá|3305133
0785|MA|Gonçalves Dias|2104404
0786|RJ|Seropédica|3305554
0787|MA|Governador Archer|2104503
0788|RJ|Tanguá|3305752
0789|MA|Governador Eugênio Barros|2104602
0790|SP|Arco-Íris|3503356
0791|MA|Graça Aranha|2104701
0792|SP|Brejo Alegre|3507753
0793|MA|Grajaú|2104800
0794|SP|Canas|3509957
0795|MA|Guimarães|2104909
0796|SP|Fernão|3515657
0797|MA|Humberto de Campos|2105005
0798|SP|Gavião Peixoto|3516853
0799|MA|Icatu|2105104
0800|SP|Ipiguá|3521150
0801|MA|Igarapé Grande|2105203
0802|SP|Jumirim|3525854
0803|MA|Imperatriz|2105302
0804|SP|Nantes|3532157
0805|MA|São Luís Gonzaga do Maranhão|2111409
0806|SP|Nova Castilho|3532868
0807|MA|Itapecuru Mirim|2105401
0808|SP|Ouroeste|3534757
0809|MA|João Lisboa|2105500
0810|SP|Paulistânia|3536570
0811|MA|Joselândia|2105609
0812|SP|Pracinha|3540853
0813|MA|Lago da Pedra|2105708
0814|SP|Pratânia|3541059
0815|MA|Lago do Junco|2105807
0816|SP|Quadra|3541653
0817|MA|Lago Verde|2105906
0818|SP|Ribeirão dos Índios|3543238
0819|MA|Lima Campos|2106003
0820|SP|Santa Cruz da Esperança|3546256
0821|MA|Loreto|2106102
0822|SP|Santa Salete|3547650
0823|MA|Luís Domingues|2106201
0824|SP|Taquaral|3553658
0825|MA|Magalhães de Almeida|2106300
0826|SP|Trabiju|3554755
0827|MA|Mata Roma|2106409
0828|SP|Vitória Brasil|3556958
0829|MA|Matinha|2106508
0830|PR|Arapuã|4101655
0831|MA|Matões|2106607
0832|PR|Ariranha do Ivaí|4101853
0833|MA|Mirador|2106706
0834|PR|Bela Vista da Caroba|4102752
0835|MA|Mirinzal|2106805
0836|PR|Boa Ventura de São Roque|4103040
0837|MA|Monção|2106904
0838|PR|Bom Jesus do Sul|4103156
0839|MA|Montes Altos|2107001
0840|PR|Campina do Simão|4103958
0841|MA|Morros|2107100
0842|PR|Campo Magro|4104253
0843|MA|Nina Rodrigues|2107209
0844|PR|Carambeí|4104659
0845|MA|Nova Iorque|2107308
0846|PR|Coronel Domingos Soares|4106456
0847|MA|Olho d'Água das Cunhãs|2107407
0848|PR|Cruzmaltina|4106852
0849|MA|Paço do Lumiar|2107506
0850|PR|Esperança Nova|4107520
0851|MA|Palmeirândia|2107605
0852|PR|Espigão Alto do Iguaçu|4107546
0853|MA|Paraibano|2107704
0854|PR|Fernandes Pinheiro|4107736
0855|MA|Parnarama|2107803
0856|PR|Foz do Jordão|4108452
0857|MA|Passagem Franca|2107902
0858|PR|Goioxim|4108650
0859|MA|Pastos Bons|2108009
0860|PR|Guamiranga|4108957
0861|MA|Pedreiras|2108207
0862|PR|Imbaú|4110078
0863|MA|Penalva|2108306
0864|PR|Manfrinópolis|4114351
0865|MA|Peri Mirim|2108405
0866|PR|Marquinho|4115457
0867|MA|Pindaré-Mirim|2108504
0868|PR|Perobal|4118857
0869|MA|Pinheiro|2108603
0870|PR|Pontal do Paraná|4119954
0871|MA|Pio XII|2108702
0872|PR|Porto Barreiro|4120150
0873|MA|Pirapemas|2108801
0874|PR|Prado Ferreira|4120333
0875|MA|Poção de Pedras|2108900
0876|PR|Quarto Centenário|4120655
0877|MA|Porto Franco|2109007
0878|PR|Reserva do Iguaçu|4121752
0879|MA|Presidente Dutra|2109106
0880|PR|Rio Branco do Ivaí|4122172
0881|MA|Presidente Juscelino|2109205
0882|PR|Serranópolis do Iguaçu|4126355
0883|MA|Presidente Vargas|2109304
0884|PR|Tamarana|4126678
0885|MA|Primeira Cruz|2109403
0886|SC|Alto Bela Vista|4200754
0887|MA|Riachão|2109502
0888|SC|Balneário Arroio do Silva|4201950
0889|MA|São José de Ribamar|2111201
0890|SC|Balneário Gaivota|4202073
0891|MA|Rosário|2109601
0892|SC|Bandeirante|4202081
0893|MA|Sambaíba|2109700
0894|SC|Barra Bonita|4202099
0895|MA|Santa Helena|2109809
0896|SC|Bela Vista do Toldo|4202131
0897|MA|Santa Luzia|2110005
0898|SC|Bocaina do Sul|4202438
0899|MA|Santa Quitéria do Maranhão|2110104
0900|SC|Bom Jesus|4202537
0901|MA|Santa Rita|2110203
0902|SC|Bom Jesus do Oeste|4202578
0903|MA|Santo Antônio dos Lopes|2110302
0904|SC|Brunópolis|4202875
0905|MA|São Benedito do Rio Preto|2110401
0906|SC|Capão Alto|4203253
0907|MA|São Bento|2110500
0908|SC|Chapadão do Lageado|4204194
0909|MA|São Bernardo|2110609
0910|SC|Cunhataí|4204756
0911|MA|São Domingos do Maranhão|2110708
0912|SC|Entre Rios|4205175
0913|MA|São Félix de Balsas|2110807
0914|SC|Ermo|4205191
0915|MA|São Francisco do Maranhão|2110906
0916|SC|Flor do Sertão|4205357
0917|MA|São João Batista|2111003
0918|SC|Frei Rogério|4205555
0919|MA|São João dos Patos|2111102
0920|SC|Ibiam|4206751
0921|MA|São Luís|2111300
0922|SC|Iomerê|4207577
0923|MA|São Mateus do Maranhão|2111508
0924|SC|Jupiá|4209177
0925|MA|São Raimundo das Mangabeiras|2111607
0926|SC|Luzerna|4210035
0927|MA|São Vicente Ferrer|2111706
0928|SC|Paial|4211876
0929|MA|Sítio Novo|2111805
0930|SC|Painel|4211892
0931|MA|Sucupira do Norte|2111904
0932|SC|Palmeira|4212056
0933|MA|Tasso Fragoso|2112001
0934|SC|Princesa|4214151
0935|MA|Timbiras|2112100
0936|SC|Saltinho|4215356
0937|MA|Timon|2112209
0938|SC|Santa Terezinha do Progresso|4215687
0939|MA|Tuntum|2112308
0940|SC|Santiago do Sul|4215695
0941|MA|Turiaçu|2112407
0942|SC|São Bernardino|4215752
0943|MA|Tutóia|2112506
0944|SC|São Pedro de Alcântara|4217253
0945|MA|Urbano Santos|2112605
0946|SC|Tigrinhos|4217956
0947|MA|Vargem Grande|2112704
0948|SC|Treviso|4218350
0949|MA|Viana|2112803
0950|SC|Zortéa|4219853
0951|MA|Vitória do Mearim|2112902
0952|RS|Araricá|4300877
0953|MA|Vitorino Freire|2113009
0954|RS|Balneário Pinhal|4301636
0955|MA|Bom Jardim|2102002
0956|RS|Barra do Quaraí|4301875
0957|MA|Santa Inês|2109908
0958|RS|Benjamin Constant do Sul|4302055
0959|MA|Paulo Ramos|2108108
0960|RS|Boa Vista do Sul|4302253
0961|MA|Açailândia|2100055
0962|RS|Capivari do Sul|4304671
0963|MA|Estreito|2104057
0964|RS|Caraá|4304713
0965|AM|Careiro da Várzea|1301159
0966|RS|Cerrito|4305124
0967|AM|Guajará|1301654
0968|RS|Chuí|4305439
0969|AM|Apuí|1300144
0970|RS|Chuvisca|4305447
0971|AL|Teotônio Vilela|2709152
0972|RS|Cristal do Sul|4306072
0973|SC|Forquilhinha|4205456
0974|RS|Dilermando de Aguiar|4306379
0975|RO|Theobroma|1101609
0976|RS|Dom Pedro de Alcântara|4306551
0977|RO|Urupá|1101708
0978|RS|Doutor Ricardo|4306759
0979|RO|Vale do Paraíso|1101807
0980|RS|Esperança do Sul|4307450
0981|RO|Corumbiara|1100072
0982|RS|Estrela Velha|4307815
0983|CE|Catunda|2303659
0984|RS|Fazenda Vilanova|4308078
0985|CE|Jijoca de Jericoacoara|2307254
0986|RS|Floriano Peixoto|4308250
0987|CE|Fortim|2304459
0988|RS|Herveiras|4309571
0989|CE|Ararendá|2301257
0990|RS|Itaara|4310538
0991|CE|Itaitinga|2306256
0992|RS|Jari|4311130
0993|CE|Choró|2303931
0994|RS|Maçambará|4311718
0995|PI|Coivaras|2202737
0996|RS|Mampituba|4311734
0997|PI|Jardim do Mulato|2205250
0998|RS|Marques de Souza|4312054
0999|PI|Lagoa Alegre|2205557
1000|RS|Monte Alegre dos Campos|4312377
1001|PI|Agricolândia|2200103
1002|RS|Muitos Capões|4312617
1003|PI|Água Branca|2200202
1004|RS|Nova Candelária|4313011
1005|PI|Alto Longá|2200301
1006|RS|Nova Ramada|4313334
1007|PI|Altos|2200400
1008|RS|Novo Cabrais|4313391
1009|PI|Amarante|2200509
1010|RS|Passa Sete|4314068
1011|PI|Angical do Piauí|2200608
1012|RS|Senador Salgado Filho|4320321
1013|PI|Anísio de Abreu|2200707
1014|RS|Sete de Setembro|4320578
1015|PI|Antônio Almeida|2200806
1016|RS|Tabaí|4320859
1017|PI|Aroazes|2200905
1018|RS|Toropi|4321493
1019|PI|Arraial|2201002
1020|RS|Turuçu|4322327
1021|PI|Avelino Lopes|2201101
1022|RS|Ubiretama|4322343
1023|PI|Barras|2201200
1024|RS|Unistalda|4322376
1025|PI|Barreiras do Piauí|2201309
1026|RS|Vale Verde|4322525
1027|PI|Barro Duro|2201408
1028|RS|Vespasiano Corrêa|4322855
1029|PI|Batalha|2201507
1030|RS|Vila Lângaro|4323358
1031|PI|Beneditinos|2201606
1032|MT|Campos de Júlio|5102686
1033|PI|Bertolínia|2201705
1034|MT|Carlinda|5102793
1035|PI|Bocaina|2201804
1036|MT|Feliz Natal|5103700
1037|PI|Bom Jesus|2201903
1038|MT|Gaúcha do Norte|5103858
1039|PI|Buriti dos Lopes|2202000
1040|MT|Nova Lacerda|5106182
1041|PI|Campinas do Piauí|2202109
1042|MT|Nova Ubiratã|5106240
1043|PI|Campo Maior|2202208
1044|MT|Novo Mundo|5106265
1045|PI|Canto do Buriti|2202307
1046|MT|Sapezal|5107875
1047|PI|Capitão de Campos|2202406
1048|MT|União do Sul|5108303
1049|PI|Caracol|2202505
1050|GO|Abadia de Goiás|5200050
1051|PI|Castelo do Piauí|2202604
1052|GO|Águas Lindas de Goiás|5200258
1053|PI|Cocal|2202703
1054|GO|Amaralina|5200829
1055|PI|Conceição do Canindé|2202802
1056|GO|Bonópolis|5203575
1057|PI|Corrente|2202901
1058|GO|Novo Gama|5215231
1059|PI|Cristalândia do Piauí|2203008
1060|GO|Porteirão|5218052
1061|PI|Cristino Castro|2203107
1062|GO|Santa Rita do Novo Destino|5219456
1063|PI|Curimatá|2203206
1064|GO|São Patrício|5220280
1065|PI|Demerval Lobão|2203305
1066|GO|Valparaíso de Goiás|5221858
1067|PI|Dom Expedito Lopes|2203404
1068|GO|Vila Propício|5222302
1069|PI|Elesbão Veloso|2203503
1071|PI|Eliseu Martins|2203602
1073|PI|Esperantina|2203701
1075|PI|Flores do Piauí|2203800
1077|PI|Floriano|2203909
1079|PI|Francinópolis|2204006
1081|PI|Francisco Ayres|2204105
1083|PI|Francisco Santos|2204204
1085|PI|Fronteiras|2204303
1087|PI|Gilbués|2204402
1089|PI|Guadalupe|2204501
1091|PI|Hugo Napoleão|2204600
1093|PI|Inhuma|2204709
1094|MT|Santa Cruz do Xingu|5107743
1095|PI|Ipiranga do Piauí|2204808
1096|MT|Santa Rita do Trivelato|5107768
1097|PI|Isaías Coelho|2204907
1098|MT|Santo Antônio do Leste|5107792
1099|PI|Itainópolis|2205003
1100|MT|Serra Nova Dourada|5107883
1101|PI|Itaueira|2205102
1102|MT|Vale de São Domingos|5108352
1103|PI|Jaicós|2205201
1104|PI|Pau D'Arco do Piauí|2207793
1105|PI|Jerumenha|2205300
1107|PI|Joaquim Pires|2205409
1108|RN|Jundiá|2406155
1109|PI|José de Freitas|2205508
1111|PI|Landri Sales|2205607
1113|PI|Luís Correia|2205706
1115|PI|Luzilândia|2205805
1116|RJ|Mesquita|3302858
1117|PI|Manoel Emídio|2205904
1118|RS|Aceguá|4300034
1119|PI|Marcos Parente|2206001
1120|RS|Almirante Tamandaré do Sul|4300471
1121|PI|Matias Olímpio|2206100
1122|RS|Arroio do Padre|4301073
1123|PI|Miguel Alves|2206209
1124|RS|Boa Vista do Cadeado|4302220
1125|PI|Miguel Leão|2206308
1126|RS|Boa Vista do Incra|4302238
1127|PI|Monsenhor Gil|2206407
1128|RS|Bozano|4302584
1129|PI|Monsenhor Hipólito|2206506
1130|RS|Canudos do Vale|4304614
1131|PI|Monte Alegre do Piauí|2206605
1132|RS|Capão Bonito do Sul|4304622
1133|PI|Nazaré do Piauí|2206704
1134|RS|Capão do Cipó|4304655
1135|PI|Nossa Senhora dos Remédios|2206803
1136|RS|Coqueiro Baixo|4305835
1137|PI|Novo Oriente do Piauí|2206902
1138|RS|Coronel Pilar|4305934
1139|PI|Oeiras|2207009
1140|RS|Cruzaltense|4306130
1141|PI|Domingos Mourão|2203420
1142|RS|Forquetinha|4308433
1143|PI|Padre Marcos|2207207
1144|RS|Itati|4310652
1145|PI|Paes Landim|2207306
1146|RS|Jacuizinho|4310876
1147|PI|Palmeira do Piauí|2207405
1148|RS|Lagoa Bonita do Sul|4311239
1149|PI|Palmeirais|2207504
1150|RS|Mato Queimado|4312179
1151|PI|Parnaguá|2207603
1152|RS|Novo Xingu|4313466
1153|PI|Parnaíba|2207702
1154|RS|Paulo Bento|4314134
1155|PI|Paulistana|2207801
1156|RS|Pedras Altas|4314175
1157|PI|Pedro II|2207900
1158|RS|Pinhal da Serra|4314464
1159|PI|Picos|2208007
1160|RS|Pinto Bandeira|4314548
1161|PI|Pimenteiras|2208106
1162|RS|Quatro Irmãos|4315313
1163|PI|Pio IX|2208205
1164|RS|Rolador|4315958
1165|PI|Piracuruca|2208304
1166|RS|Santa Cecília do Sul|4316733
1167|PI|Piripiri|2208403
1168|RS|Santa Margarida do Sul|4316972
1169|PI|Porto|2208502
1170|RS|São José do Sul|4318614
1171|PI|Prata do Piauí|2208601
1172|RS|São Pedro das Missões|4319364
1173|PI|Redenção do Gurguéia|2208700
1174|RS|Tio Hugo|4321469
1175|PI|Regeneração|2208809
1176|RS|Westfália|4323770
1177|PI|Ribeiro Gonçalves|2208908
1178|MS|Figueirão|5003900
1179|PI|Rio Grande do Piauí|2209005
1181|PI|Santa Cruz do Piauí|2209104
1183|PI|Santa Filomena|2209203
1184|MT|Ipiranga do Norte|5104526
1185|PI|Santa Luz|2209302
1186|MT|Itanhangá|5104542
1187|PI|Santo Antônio de Lisboa|2209401
1188|PI|Aroeiras do Itaim|2200954
1189|PI|Santo Inácio do Piauí|2209500
1191|PI|São Félix do Piauí|2209609
1193|PI|São Francisco do Piauí|2209708
1195|PI|São Gonçalo do Piauí|2209807
1197|PI|São João da Serra|2209906
1199|PI|São João do Piauí|2210003
1201|PI|São José do Peixe|2210102
1203|PI|São José do Piauí|2210201
1205|PI|São Julião|2210300
1207|PI|São Miguel do Tapuio|2210409
1209|PI|São Pedro do Piauí|2210508
1211|PI|São Raimundo Nonato|2210607
1213|PI|Simões|2210706
1215|PI|Simplício Mendes|2210805
1217|PI|Socorro do Piauí|2210904
1219|PI|Teresina|2211001
1221|PI|União|2211100
1223|PI|Uruçuí|2211209
1225|PI|Valença do Piauí|2211308
1227|PI|Várzea Grande|2211407
1229|PI|Dirceu Arcoverde|2203354
1231|CE|Acarape|2300150
1233|CE|Banabuiú|2301851
1235|CE|Barreira|2301950
1237|CE|Barroquinha|2302057
1239|CE|Chorozinho|2303956
1241|CE|Croatá|2304236
1243|CE|Deputado Irapuan Pinheiro|2304269
1245|CE|Ereré|2304277
1247|CE|Eusébio|2304285
1249|CE|Graça|2304657
1251|CE|Guaiúba|2304954
1253|CE|Horizonte|2305233
1255|CE|Ibaretama|2305266
1257|CE|Ibicuitinga|2305332
1259|CE|Ipaporanga|2305654
1261|CE|Madalena|2307635
1263|CE|Miraíma|2308377
1265|CE|Ocara|2309458
1267|CE|Pindoretama|2310852
1269|CE|Pires Ferreira|2310951
1271|CE|Potiretama|2311231
1273|CE|Salitre|2311959
1275|CE|Tarrafas|2313252
1277|CE|Tejuçuoca|2313351
1279|CE|Tururu|2313559
1281|MA|Arame|2100956
1283|MA|Miranda do Norte|2106755
1285|MA|Santa Luzia do Paruá|2110039
1287|MA|Zé Doca|2114007
1289|PI|Dom Inocêncio|2203453
1291|PI|São João da Canabrava|2209856
1293|PI|Passagem Franca do Piauí|2207751
1295|PI|Santa Cruz dos Milagres|2209153
1297|PI|Buriti dos Montes|2202026
1299|PI|Cabeceiras do Piauí|2202059
1301|CE|Abaiara|2300101
1303|CE|Acaraú|2300200
1305|CE|Acopiara|2300309
1307|CE|Aiuaba|2300408
1309|CE|Alcântaras|2300507
1311|CE|Altaneira|2300606
1313|CE|Alto Santo|2300705
1315|CE|Antonina do Norte|2300804
1317|CE|Apuiarés|2300903
1319|CE|Aquiraz|2301000
1321|CE|Aracati|2301109
1323|CE|Aracoiaba|2301208
1325|CE|Araripe|2301307
1327|CE|Aratuba|2301406
1329|CE|Arneiroz|2301505
1331|CE|Assaré|2301604
1333|CE|Aurora|2301703
1335|CE|Baixio|2301802
1337|CE|Barbalha|2301901
1339|CE|Barro|2302008
1341|CE|Baturité|2302107
1343|CE|Beberibe|2302206
1345|CE|Bela Cruz|2302305
1347|CE|Boa Viagem|2302404
1349|CE|Brejo Santo|2302503
1351|CE|Camocim|2302602
1353|CE|Campos Sales|2302701
1355|CE|Canindé|2302800
1357|CE|Capistrano|2302909
1359|CE|Caridade|2303006
1361|CE|Cariré|2303105
1363|CE|Caririaçu|2303204
1365|CE|Cariús|2303303
1367|CE|Carnaubal|2303402
1369|CE|Cascavel|2303501
1371|CE|Catarina|2303600
1373|CE|Caucaia|2303709
1375|CE|Cedro|2303808
1377|CE|Chaval|2303907
1379|PI|Sigefredo Pacheco|2210656
1381|CE|Coreaú|2304004
1383|CE|Crateús|2304103
1385|CE|Crato|2304202
1387|CE|Farias Brito|2304301
1389|CE|Fortaleza|2304400
1391|CE|Frecheirinha|2304509
1393|CE|General Sampaio|2304608
1395|CE|Granja|2304707
1397|CE|Granjeiro|2304806
1399|CE|Groaíras|2304905
1401|CE|Guaraciaba do Norte|2305001
1403|CE|Guaramiranga|2305100
1405|CE|Hidrolândia|2305209
1407|CE|Ibiapina|2305308
1409|CE|Icó|2305407
1411|CE|Iguatu|2305506
1413|CE|Independência|2305605
1415|CE|Ipaumirim|2305704
1417|CE|Ipu|2305803
1419|CE|Ipueiras|2305902
1421|CE|Iracema|2306009
1423|CE|Irauçuba|2306108
1425|CE|Itaiçaba|2306207
1427|CE|Itapajé|2306306
1429|CE|Itapipoca|2306405
1431|CE|Itapiúna|2306504
1433|CE|Itatira|2306603
1435|CE|Jaguaretama|2306702
1437|CE|Jaguaribara|2306801
1439|CE|Jaguaribe|2306900
1441|CE|Jaguaruana|2307007
1443|CE|Jardim|2307106
1445|CE|Jati|2307205
1447|CE|Juazeiro do Norte|2307304
1449|CE|Jucás|2307403
1451|CE|Lavras da Mangabeira|2307502
1453|CE|Limoeiro do Norte|2307601
1455|CE|Maranguape|2307700
1457|CE|Marco|2307809
1459|CE|Martinópole|2307908
1461|CE|Massapê|2308005
1463|CE|Mauriti|2308104
1465|CE|Meruoca|2308203
1467|CE|Milagres|2308302
1469|CE|Missão Velha|2308401
1471|CE|Mombaça|2308500
1473|CE|Monsenhor Tabosa|2308609
1475|CE|Morada Nova|2308708
1477|CE|Moraújo|2308807
1479|CE|Morrinhos|2308906
1481|CE|Mucambo|2309003
1483|CE|Mulungu|2309102
1485|CE|Nova Olinda|2309201
1487|CE|Nova Russas|2309300
1489|CE|Novo Oriente|2309409
1491|CE|Orós|2309508
1493|CE|Pacajus|2309607
1495|CE|Pacatuba|2309706
1497|CE|Pacoti|2309805
1499|CE|Pacujá|2309904
1501|CE|Palhano|2310001
1503|CE|Palmácia|2310100
1505|CE|Paracuru|2310209
1507|CE|Parambu|2310308
1509|CE|Paramoti|2310407
1511|CE|Pedra Branca|2310506
1513|CE|Penaforte|2310605
1515|CE|Pentecoste|2310704
1517|CE|Pereiro|2310803
1519|CE|Piquet Carneiro|2310902
1521|CE|Poranga|2311009
1523|CE|Porteiras|2311108
1525|CE|Potengi|2311207
1527|CE|Quixadá|2311306
1529|CE|Quixeramobim|2311405
1531|CE|Quixeré|2311504
1533|CE|Redenção|2311603
1535|CE|Reriutaba|2311702
1537|CE|Russas|2311801
1539|CE|Saboeiro|2311900
1541|CE|Santana do Acaraú|2312007
1543|CE|Santana do Cariri|2312106
1545|CE|Santa Quitéria|2312205
1547|CE|São Benedito|2312304
1549|CE|São Gonçalo do Amarante|2312403
1551|CE|São João do Jaguaribe|2312502
1553|CE|São Luís do Curu|2312601
1555|CE|Senador Pompeu|2312700
1557|CE|Senador Sá|2312809
1559|CE|Sobral|2312908
1561|CE|Solonópole|2313005
1563|CE|Tabuleiro do Norte|2313104
1565|CE|Tamboril|2313203
1567|CE|Tauá|2313302
1569|CE|Tianguá|2313401
1571|CE|Trairi|2313500
1573|CE|Ubajara|2313609
1575|CE|Umari|2313708
1577|CE|Uruburetama|2313807
1579|CE|Uruoca|2313906
1581|CE|Várzea Alegre|2314003
1583|CE|Viçosa do Ceará|2314102
1585|CE|Maracanaú|2307650
1587|CE|Amontada|2300754
1589|CE|Cruz|2304251
1591|CE|Forquilha|2304350
1593|CE|Icapuí|2305357
1595|CE|Itarema|2306553
1597|CE|Milhã|2308351
1599|CE|Paraipaba|2310258
1601|RN|Acari|2400109
1603|RN|Açu|2400208
1605|RN|Afonso Bezerra|2400307
1607|RN|Água Nova|2400406
1609|RN|Alexandria|2400505
1611|RN|Almino Afonso|2400604
1613|RN|Alto do Rodrigues|2400703
1615|RN|Angicos|2400802
1617|RN|Antônio Martins|2400901
1619|RN|Apodi|2401008
1621|RN|Areia Branca|2401107
1623|RN|Arês|2401206
1625|RN|Campo Grande|2401305
1627|RN|Baía Formosa|2401404
1629|RN|Barcelona|2401503
1631|RN|Bento Fernandes|2401602
1633|RN|Bom Jesus|2401701
1635|RN|Brejinho|2401800
1637|RN|Caiçara do Rio do Vento|2401909
1639|RN|Caicó|2402006
1641|RN|Campo Redondo|2402105
1643|RN|Canguaretama|2402204
1645|RN|Caraúbas|2402303
1647|RN|Carnaúba dos Dantas|2402402
1649|RN|Carnaubais|2402501
1651|RN|Ceará-Mirim|2402600
1653|RN|Cerro Corá|2402709
1655|RN|Coronel Ezequiel|2402808
1657|RN|Coronel João Pessoa|2402907
1659|RN|Cruzeta|2403004
1661|RN|Currais Novos|2403103
1663|RN|Doutor Severiano|2403202
1665|RN|Encanto|2403301
1667|RN|Equador|2403400
1669|RN|Espírito Santo|2403509
1671|RN|Extremoz|2403608
1673|RN|Felipe Guerra|2403707
1675|RN|Florânia|2403806
1677|RN|Francisco Dantas|2403905
1679|RN|Galinhos|2404101
1681|RN|Goianinha|2404200
1683|RN|Governador Dix-Sept Rosado|2404309
1685|RN|Grossos|2404408
1687|RN|Guamaré|2404507
1689|RN|Ielmo Marinho|2404606
1691|RN|Ipanguaçu|2404705
1693|RN|Ipueira|2404804
1695|RN|Itaú|2404903
1697|RN|Jaçanã|2405009
1699|RN|Jandaíra|2405108
1701|RN|Janduís|2405207
1703|RN|Januário Cicco|2405306
1705|RN|Japi|2405405
1707|RN|Jardim de Angicos|2405504
1709|RN|Jardim de Piranhas|2405603
1711|RN|Jardim do Seridó|2405702
1713|RN|João Câmara|2405801
1715|RN|João Dias|2405900
1717|RN|José da Penha|2406007
1719|RN|Jucurutu|2406106
1721|RN|Messias Targino|2407609
1723|RN|Lagoa d'Anta|2406205
1725|RN|Lagoa de Pedras|2406304
1727|RN|Lagoa de Velhos|2406403
1729|RN|Lagoa Nova|2406502
1731|RN|Lagoa Salgada|2406601
1733|RN|Lajes|2406700
1735|RN|Lajes Pintadas|2406809
1737|RN|Lucrécia|2406908
1739|RN|Luís Gomes|2407005
1741|RN|Macaíba|2407104
1743|RN|Macau|2407203
1745|RN|Marcelino Vieira|2407302
1747|RN|Martins|2407401
1749|RN|Maxaranguape|2407500
1751|RN|Frutuoso Gomes|2404002
1753|RN|Montanhas|2407708
1755|RN|Monte Alegre|2407807
1757|RN|Monte das Gameleiras|2407906
1759|RN|Mossoró|2408003
1761|RN|Natal|2408102
1763|RN|Nísia Floresta|2408201
1765|RN|Nova Cruz|2408300
1767|RN|Olho d'Água do Borges|2408409
1769|RN|Ouro Branco|2408508
1771|RN|Paraná|2408607
1773|RN|Paraú|2408706
1775|RN|Parazinho|2408805
1777|RN|Parelhas|2408904
1779|RN|Parnamirim|2403251
1781|RN|Passa e Fica|2409100
1783|RN|Passagem|2409209
1785|RN|Patu|2409308
1787|RN|Pau dos Ferros|2409407
1789|RN|Pedra Grande|2409506
1791|RN|Pedra Preta|2409605
1793|RN|Pedro Avelino|2409704
1795|RN|Pedro Velho|2409803
1797|RN|Pendências|2409902
1799|RN|Pilões|2410009
1801|RN|Poço Branco|2410108
1803|RN|Portalegre|2410207
1805|RN|Serra Caiada|2410306
1807|RN|Pureza|2410405
1809|RN|Rafael Fernandes|2410504
1811|RN|Riacho da Cruz|2410702
1813|RN|Riacho de Santana|2410801
1815|RN|Riachuelo|2410900
1817|RN|Rodolfo Fernandes|2411007
1819|RN|Ruy Barbosa|2411106
1821|RN|São Francisco do Oeste|2411908
1823|RN|Santa Cruz|2411205
1825|RN|Santana do Seridó|2411429
1827|RN|Santana do Matos|2411403
1829|RN|Santo Antônio|2411502
1831|RN|São Bento do Norte|2411601
1833|RN|São Bento do Trairí|2411700
1835|RN|São Fernando|2411809
1837|RN|São Gonçalo do Amarante|2412005
1839|RN|São João do Sabugi|2412104
1841|RN|São José de Mipibu|2412203
1843|RN|São José do Campestre|2412302
1845|RN|São José do Seridó|2412401
1847|RN|São Miguel|2412500
1849|RN|São Paulo do Potengi|2412609
1851|RN|São Pedro|2412708
1853|RN|São Rafael|2412807
1855|RN|São Tomé|2412906
1857|RN|São Vicente|2413003
1859|RN|Senador Elói de Souza|2413102
1861|RN|Senador Georgino Avelino|2413201
1863|RN|Serra de São Bento|2413300
1865|RN|Serra Negra do Norte|2413409
1867|RN|Serrinha|2413508
1869|RN|Severiano Melo|2413607
1871|RN|Sítio Novo|2413706
1873|RN|Taboleiro Grande|2413805
1875|RN|Taipu|2413904
1877|RN|Tangará|2414001
1879|RN|Tenente Ananias|2414100
1881|RN|Tibau do Sul|2414209
1883|RN|Timbaúba dos Batistas|2414308
1885|RN|Touros|2414407
1887|RN|Umarizal|2414506
1889|RN|Upanema|2414605
1891|RN|Várzea|2414704
1893|RN|Rafael Godeiro|2410603
1895|RN|Vera Cruz|2414803
1897|RN|Viçosa|2414902
1899|RN|Vila Flor|2415008
1901|PB|Água Branca|2500106
1903|PB|Aguiar|2500205
1905|PB|Alagoa Grande|2500304
1907|PB|Alagoa Nova|2500403
1909|PB|Alagoinha|2500502
1911|PB|Alhandra|2500601
1913|PB|São João do Rio do Peixe|2500700
1915|PB|Araçagi|2500809
1917|PB|Arara|2500908
1919|PB|Araruna|2501005
1921|PB|Areia|2501104
1923|PB|Areial|2501203
1925|PB|Aroeiras|2501302
1927|RN|Serra do Mel|2413359
1929|PB|Baía da Traição|2501401
1931|PB|Bananeiras|2501500
1933|PB|Barra de Santa Rosa|2501609
1935|PB|Barra de São Miguel|2501708
1937|PB|Bayeux|2501807
1939|PB|Belém|2501906
1941|PB|Belém do Brejo do Cruz|2502003
1943|PB|Boa Ventura|2502102
1945|PB|Bom Jesus|2502201
1947|PB|Bom Sucesso|2502300
1949|PB|Bonito de Santa Fé|2502409
1951|PB|Boqueirão|2502508
1953|PB|Igaracy|2502607
1955|PB|Borborema|2502706
1957|PB|Brejo do Cruz|2502805
1959|PB|Brejo dos Santos|2502904
1961|PB|Caaporã|2503001
1963|PB|Cabaceiras|2503100
1965|PB|Cabedelo|2503209
1967|PB|Cachoeira dos Índios|2503308
1969|PB|Cacimba de Areia|2503407
1971|PB|Cacimba de Dentro|2503506
1973|PB|Caiçara|2503605
1975|PB|Cajazeiras|2503704
1977|PB|Caldas Brandão|2503803
1979|PB|Camalaú|2503902
1981|PB|Campina Grande|2504009
1983|PB|Carrapateira|2504108
1985|PB|Catingueira|2504207
1987|PB|Catolé do Rocha|2504306
1989|PB|Conceição|2504405
1991|PB|Condado|2504504
1993|PB|Conde|2504603
1995|PB|Congo|2504702
1997|PB|Coremas|2504801
1999|PB|Cruz do Espírito Santo|2504900
2001|PB|Cubati|2505006
2003|PB|Cuité|2505105
2005|PB|Cuitegi|2505204
2007|PB|Curral Velho|2505303
2009|PB|Desterro|2505402
2011|PB|Vista Serrana|2505501
2013|PB|Diamante|2505600
2015|PB|Dona Inês|2505709
2017|PB|Duas Estradas|2505808
2019|PB|Emas|2505907
2021|PB|Esperança|2506004
2023|PB|Fagundes|2506103
2025|PB|Frei Martinho|2506202
2027|PB|Guarabira|2506301
2029|PB|Gurinhém|2506400
2031|PB|Gurjão|2506509
2033|PB|Ibiara|2506608
2035|PB|Imaculada|2506707
2037|PB|Ingá|2506806
2039|PB|Itabaiana|2506905
2041|PB|Itaporanga|2507002
2043|PB|Itapororoca|2507101
2045|PB|Itatuba|2507200
2047|PB|Jacaraú|2507309
2049|PB|Jericó|2507408
2051|PB|João Pessoa|2507507
2053|PB|Juarez Távora|2507606
2055|PB|Juazeirinho|2507705
2057|PB|Junco do Seridó|2507804
2059|PB|Juripiranga|2507903
2061|PB|Juru|2508000
2063|PB|Lagoa|2508109
2065|PB|Lagoa de Dentro|2508208
2067|PB|Lagoa Seca|2508307
2069|PB|Lastro|2508406
2071|PB|Livramento|2508505
2073|PB|Lucena|2508604
2075|PB|Mãe d'Água|2508703
2077|PB|Malta|2508802
2079|PB|Mamanguape|2508901
2081|PB|Manaíra|2509008
2083|PB|Mari|2509107
2085|PB|Massaranduba|2509206
2087|PB|Mataraca|2509305
2089|PB|Mogeiro|2509404
2091|PB|Montadas|2509503
2093|PB|Monte Horebe|2509602
2095|PB|Monteiro|2509701
2097|PB|Mulungu|2509800
2099|PB|Natuba|2509909
2101|PB|Nazarezinho|2510006
2103|PB|Nova Floresta|2510105
2105|PB|Nova Olinda|2510204
2107|PB|Nova Palmeira|2510303
2109|PB|Olho d'Água|2510402
2111|PB|Olivedos|2510501
2113|PB|Ouro Velho|2510600
2115|PB|Passagem|2510709
2117|PB|Patos|2510808
2119|PB|Paulista|2510907
2121|PB|Pedra Branca|2511004
2123|PB|Pedra Lavrada|2511103
2125|PB|Pedras de Fogo|2511202
2127|PB|Piancó|2511301
2129|PB|Picuí|2511400
2131|PB|Pilar|2511509
2133|PB|Pilões|2511608
2135|PB|Pilõezinhos|2511707
2137|PB|Pirpirituba|2511806
2139|PB|Pitimbu|2511905
2141|PB|Pocinhos|2512002
2143|PB|Pombal|2512101
2145|PB|Prata|2512200
2147|PB|Princesa Isabel|2512309
2149|PB|Puxinanã|2512408
2151|PB|Queimadas|2512507
2153|PB|Quixaba|2512606
2155|PB|Remígio|2512705
2157|PB|Riacho dos Cavalos|2512804
2159|PB|Rio Tinto|2512903
2161|PB|Salgadinho|2513000
2163|PB|Salgado de São Félix|2513109
2165|PB|Santa Cruz|2513208
2167|PB|Santa Helena|2513307
2169|PB|Santa Luzia|2513406
2171|PB|Santana de Mangueira|2513505
2173|PB|Santana dos Garrotes|2513604
2175|PB|Santa Rita|2513703
2177|PB|Santa Teresinha|2513802
2179|PB|São Bento|2513901
2181|PB|São João do Cariri|2514008
2183|PB|São João do Tigre|2514107
2185|PB|São José da Lagoa Tapada|2514206
2187|PB|São José de Caiana|2514305
2189|PB|São José de Espinharas|2514404
2191|PB|São José de Piranhas|2514503
2193|PB|São José do Bonfim|2514602
2195|PB|São José do Sabugi|2514701
2197|PB|São José dos Cordeiros|2514800
2199|PB|São Mamede|2514909
2201|PB|São Miguel de Taipu|2515005
2203|PB|São Sebastião de Lagoa de Roça|2515104
2205|PB|São Sebastião do Umbuzeiro|2515203
2207|PB|Sapé|2515302
2209|PB|São Vicente do Seridó|2515401
2211|PB|Serra Branca|2515500
2213|PB|Serra da Raiz|2515609
2215|PB|Serra Grande|2515708
2217|PB|Serra Redonda|2515807
2219|PB|Serraria|2515906
2221|PB|Solânea|2516003
2223|PB|Soledade|2516102
2225|PB|Sousa|2516201
2227|PB|Sumé|2516300
2229|PB|Tacima|2516409
2231|PB|Taperoá|2516508
2233|PB|Tavares|2516607
2235|PB|Teixeira|2516706
2237|PB|Triunfo|2516805
2239|PB|Uiraúna|2516904
2241|PB|Umbuzeiro|2517001
2243|PB|Várzea|2517100
2245|PI|Baixa Grande do Ribeiro|2201150
2247|PI|Canavieira|2202251
2249|PI|Colônia do Gurguéia|2202752
2251|PI|Bonfim do Piauí|2201929
2253|PI|Colônia do Piauí|2202778
2255|PI|Coronel José Dias|2202851
2257|PI|Fartura do Piauí|2203750
2259|PI|Lagoa do Barro do Piauí|2205565
2261|PI|Santa Rosa do Piauí|2209377
2263|PI|São Braz do Piauí|2209559
2265|PI|São Lourenço do Piauí|2210359
2267|PI|Várzea Branca|2211357
2269|PI|Alegrete do Piauí|2200277
2271|PI|Caldeirão Grande do Piauí|2202091
2273|PI|Jacobina do Piauí|2205151
2275|PI|Marcolândia|2205953
2277|PI|Patos do Piauí|2207777
2279|PI|Queimada Nova|2208650
2281|PI|Santana do Piauí|2209351
2283|PI|Brasileira|2201960
2285|PI|São José do Divino|2210052
2287|PI|Bom Princípio do Piauí|2201919
2289|PE|Lagoa do Carro|2608453
2291|PE|Vertente do Lério|2616183
2293|PE|Xexéu|2616506
2295|PE|Jucati|2608255
2297|PE|Santa Cruz|2612455
2299|PE|Dormentes|2605152
2301|PE|Afogados da Ingazeira|2600104
2303|PE|Afrânio|2600203
2305|PE|Agrestina|2600302
2307|PE|Água Preta|2600401
2309|PE|Águas Belas|2600500
2311|PE|Alagoinha|2600609
2313|PE|Aliança|2600708
2315|PE|Altinho|2600807
2317|PE|Amaraji|2600906
2319|PE|Angelim|2601003
2321|PE|Araripina|2601102
2323|PE|Arcoverde|2601201
2325|PE|Barra de Guabiraba|2601300
2327|PE|Barreiros|2601409
2329|PE|Belém de Maria|2601508
2331|PE|Belém do São Francisco|2601607
2333|PE|Belo Jardim|2601706
2335|PE|Betânia|2601805
2337|PE|Bezerros|2601904
2339|PE|Bodocó|2602001
2341|PE|Bom Conselho|2602100
2343|PE|Bom Jardim|2602209
2345|PE|Bonito|2602308
2347|PE|Brejão|2602407
2349|PE|Brejinho|2602506
2351|PE|Brejo da Madre de Deus|2602605
2353|PE|Buenos Aires|2602704
2355|PE|Buíque|2602803
2357|PE|Cabo de Santo Agostinho|2602902
2359|PE|Cabrobó|2603009
2361|PE|Cachoeirinha|2603108
2363|PE|Caetés|2603207
2365|PE|Calçado|2603306
2367|PE|Calumbi|2603405
2369|PE|Camocim de São Félix|2603504
2371|PE|Camutanga|2603603
2373|PE|Canhotinho|2603702
2375|PE|Capoeiras|2603801
2377|PE|Carnaíba|2603900
2379|PE|Carpina|2604007
2381|PE|Caruaru|2604106
2383|PE|Catende|2604205
2385|PE|Cedro|2604304
2387|PE|Chã de Alegria|2604403
2389|PE|Chã Grande|2604502
2391|PE|Condado|2604601
2393|PE|Correntes|2604700
2395|PE|Cortês|2604809
2397|PE|Cumaru|2604908
2399|PE|Cupira|2605004
2401|PE|Custódia|2605103
2403|PE|Escada|2605202
2405|PE|Exu|2605301
2407|PE|Feira Nova|2605400
2409|PE|Ferreiros|2605509
2411|PE|Flores|2605608
2413|PE|Floresta|2605707
2415|PE|Frei Miguelinho|2605806
2417|PE|Gameleira|2605905
2419|PE|Garanhuns|2606002
2421|PE|Glória do Goitá|2606101
2423|PE|Goiana|2606200
2425|PE|Granito|2606309
2427|PE|Gravatá|2606408
2429|PE|Iati|2606507
2431|PE|Ibimirim|2606606
2433|PE|Ibirajuba|2606705
2435|PE|Igarassu|2606804
2437|PE|Iguaracy|2606903
2439|PE|Inajá|2607000
2441|PE|Ingazeira|2607109
2443|PE|Ipojuca|2607208
2445|PE|Ipubi|2607307
2447|PE|Itacuruba|2607406
2449|PE|Itaíba|2607505
2451|PE|Ilha de Itamaracá|2607604
2453|PE|Itapetim|2607703
2455|PE|Itaquitinga|2607802
2457|PE|Jaboatão dos Guararapes|2607901
2459|PE|Jataúba|2608008
2461|PE|João Alfredo|2608107
2463|PE|Joaquim Nabuco|2608206
2465|PE|Jupi|2608305
2467|PE|Jurema|2608404
2469|PE|Lagoa de Itaenga|2608503
2471|PE|Lagoa do Ouro|2608602
2473|PE|Lagoa dos Gatos|2608701
2475|PE|Lajedo|2608800
2477|PE|Limoeiro|2608909
2479|PE|Macaparana|2609006
2481|PE|Machados|2609105
2483|PE|Maraial|2609204
2485|PE|Mirandiba|2609303
2487|PE|Moreno|2609402
2489|PE|Nazaré da Mata|2609501
2491|PE|Olinda|2609600
2493|PE|Orobó|2609709
2495|PE|Orocó|2609808
2497|PE|Ouricuri|2609907
2499|PE|Palmares|2610004
2501|PE|Palmeirina|2610103
2503|PE|Panelas|2610202
2505|PE|Paranatama|2610301
2507|PE|Parnamirim|2610400
2509|PE|Passira|2610509
2511|PE|Paudalho|2610608
2513|PE|Paulista|2610707
2515|PE|Pedra|2610806
2517|PE|Pesqueira|2610905
2519|PE|Petrolândia|2611002
2521|PE|Petrolina|2611101
2523|PE|Poção|2611200
2525|PE|Pombos|2611309
2527|PE|Primavera|2611408
2529|PE|Quipapá|2611507
2531|PE|Recife|2611606
2533|PE|Riacho das Almas|2611705
2535|PE|Ribeirão|2611804
2537|PE|Rio Formoso|2611903
2539|PE|Sairé|2612000
2541|PE|Salgadinho|2612109
2543|PE|Salgueiro|2612208
2545|PE|Saloá|2612307
2547|PE|Sanharó|2612406
2549|PE|Santa Cruz do Capibaribe|2612505
2551|PE|Santa Maria da Boa Vista|2612604
2553|PE|Santa Maria do Cambucá|2612703
2555|PE|Santa Terezinha|2612802
2557|PE|São Benedito do Sul|2612901
2559|PE|São Bento do Una|2613008
2561|PE|São Caitano|2613107
2563|PE|São João|2613206
2565|PE|São Joaquim do Monte|2613305
2567|PE|São José da Coroa Grande|2613404
2569|PE|São José do Belmonte|2613503
2571|PE|São José do Egito|2613602
2573|PE|São Lourenço da Mata|2613701
2575|PE|São Vicente Férrer|2613800
2577|PE|Serra Talhada|2613909
2579|PE|Serrita|2614006
2581|PE|Sertânia|2614105
2583|PE|Sirinhaém|2614204
2585|PE|Moreilândia|2614303
2587|PE|Solidão|2614402
2589|PE|Surubim|2614501
2591|PE|Tabira|2614600
2593|PE|Tacaimbó|2614709
2595|PE|Tacaratu|2614808
2597|PE|Itambé|2607653
2599|PE|Taquaritinga do Norte|2615003
2601|PE|Terezinha|2615102
2603|PE|Terra Nova|2615201
2605|PE|Timbaúba|2615300
2607|PE|Toritama|2615409
2609|PE|Tracunhaém|2615508
2611|PE|Trindade|2615607
2613|PE|Triunfo|2615706
2615|PE|Tupanatinga|2615805
2617|PE|Tuparetama|2615904
2619|PE|Venturosa|2616001
2621|PE|Verdejante|2616100
2623|PE|Vertentes|2616209
2625|PE|Vicência|2616308
2627|PE|Vitória de Santo Antão|2616407
2629|PE|Camaragibe|2603454
2631|PE|Abreu e Lima|2600054
2633|PE|Itapissuma|2607752
2635|PE|Carnaubeira da Penha|2603926
2637|PE|Quixaba|2611533
2639|PE|Santa Cruz da Baixa Verde|2612471
2641|AL|Paripueira|2706448
2643|AL|Estrela de Alagoas|2702553
2645|AL|Pariconha|2706422
2647|SE|Santana do São Francisco|2806404
2649|MG|São José da Lapa|3162955
2651|MG|Capitão Andrade|3112653
2653|MG|Catuji|3115458
2655|MG|Jampruca|3135076
2657|MG|Divisópolis|3122454
2659|MG|Mata Verde|3140555
2661|MG|Palmópolis|3146750
2663|MG|Entre Folhas|3123858
2665|MG|Ipaba|3131158
2667|MG|Santa Bárbara do Leste|3157252
2669|MG|Santa Rita de Minas|3159357
2671|MG|Ubaporanga|3170057
2673|MG|Santana do Paraíso|3158953
2675|MG|Durandé|3123528
2677|MG|São João do Manhuaçu|3162559
2679|MG|São João do Manteninha|3162575
2681|MG|Alfredo Vasconcelos|3101631
2683|MG|Fervedouro|3125952
2685|MG|Carneirinho|3114550
2687|MG|Limeira do Oeste|3138625
2689|MG|Senador Amaral|3165578
2691|MG|Juatuba|3136652
2693|MG|Icaraí de Minas|3130051
2695|MG|Lontra|3138658
2697|MG|Montezuma|3143450
2699|MG|Urucuia|3170529
2701|AL|Água Branca|2700102
2703|AL|Anadia|2700201
2705|AL|Arapiraca|2700300
2707|AL|Atalaia|2700409
2709|AL|Barra de Santo Antônio|2700508
2711|AL|Barra de São Miguel|2700607
2713|AL|Batalha|2700706
2715|AL|Belém|2700805
2717|AL|Belo Monte|2700904
2719|AL|Boca da Mata|2701001
2721|AL|Branquinha|2701100
2723|AL|Cacimbinhas|2701209
2725|AL|Cajueiro|2701308
2727|AL|Campo Alegre|2701407
2729|AL|Campo Grande|2701506
2731|AL|Canapi|2701605
2733|AL|Capela|2701704
2735|AL|Carneiros|2701803
2737|AL|Chã Preta|2701902
2739|AL|Coité do Nóia|2702009
2741|AL|Colônia Leopoldina|2702108
2743|AL|Coqueiro Seco|2702207
2745|AL|Coruripe|2702306
2747|AL|Delmiro Gouveia|2702405
2749|AL|Dois Riachos|2702504
2751|AL|Feira Grande|2702603
2753|AL|Feliz Deserto|2702702
2755|AL|Flexeiras|2702801
2757|AL|Girau do Ponciano|2702900
2759|AL|Ibateguara|2703007
2761|AL|Igaci|2703106
2763|AL|Igreja Nova|2703205
2765|AL|Inhapi|2703304
2767|AL|Jacaré dos Homens|2703403
2769|AL|Jacuípe|2703502
2771|AL|Japaratinga|2703601
2773|AL|Jaramataia|2703700
2775|AL|Joaquim Gomes|2703809
2777|AL|Jundiá|2703908
2779|AL|Junqueiro|2704005
2781|AL|Lagoa da Canoa|2704104
2783|AL|Limoeiro de Anadia|2704203
2785|AL|Maceió|2704302
2787|AL|Major Isidoro|2704401
2789|AL|Maragogi|2704500
2791|AL|Maravilha|2704609
2793|AL|Marechal Deodoro|2704708
2795|AL|Maribondo|2704807
2797|AL|Mar Vermelho|2704906
2799|AL|Mata Grande|2705002
2801|AL|Matriz de Camaragibe|2705101
2803|AL|Messias|2705200
2805|AL|Minador do Negrão|2705309
2807|AL|Monteirópolis|2705408
2809|AL|Murici|2705507
2811|AL|Novo Lino|2705606
2813|AL|Olho d'Água das Flores|2705705
2815|AL|Olho d'Água do Casado|2705804
2817|AL|Olho d'Água Grande|2705903
2819|AL|Olivença|2706000
2821|AL|Ouro Branco|2706109
2823|AL|Palestina|2706208
2825|AL|Palmeira dos Índios|2706307
2827|AL|Pão de Açúcar|2706406
2829|AL|Passo de Camaragibe|2706505
2831|AL|Paulo Jacinto|2706604
2833|AL|Penedo|2706703
2835|AL|Piaçabuçu|2706802
2837|AL|Pilar|2706901
2839|AL|Pindoba|2707008
2841|AL|Piranhas|2707107
2843|AL|Poço das Trincheiras|2707206
2845|AL|Porto Calvo|2707305
2847|AL|Porto de Pedras|2707404
2849|AL|Porto Real do Colégio|2707503
2851|AL|Quebrangulo|2707602
2853|AL|Rio Largo|2707701
2855|AL|Roteiro|2707800
2857|AL|Santa Luzia do Norte|2707909
2859|AL|Santana do Ipanema|2708006
2861|AL|Santana do Mundaú|2708105
2863|AL|São Brás|2708204
2865|AL|São José da Laje|2708303
2867|AL|São José da Tapera|2708402
2869|AL|São Luís do Quitunde|2708501
2871|AL|São Miguel dos Campos|2708600
2873|AL|São Miguel dos Milagres|2708709
2875|AL|São Sebastião|2708808
2877|AL|Satuba|2708907
2879|AL|Tanque d'Arca|2709004
2881|AL|Taquarana|2709103
2883|AL|Traipu|2709202
2885|AL|União dos Palmares|2709301
2887|AL|Viçosa|2709400
2889|AL|Craíbas|2702355
2891|AL|Senador Rui Palmeira|2708956
2893|MG|Jaíba|3135050
2895|MG|Mamonas|3139250
2897|MG|Matias Cardoso|3140852
2899|MG|Pedras de Maria da Cruz|3149150
2901|MG|Riachinho|3154457
2903|MG|Araporã|3103751
2905|MG|Lagoa Grande|3137536
2907|RJ|Guapimirim|3301850
2909|RJ|Belford Roxo|3300456
2911|RJ|Queimados|3304144
2913|RJ|Japeri|3302270
2915|RJ|Cardoso Moreira|3301157
2917|RJ|Varre-Sai|3306156
2919|RJ|Aperibé|3300159
2921|RJ|Rio das Ostras|3304524
2923|RJ|Quatis|3304128
2925|RJ|Areal|3300225
2927|RJ|Comendador Levy Gasparian|3300951
2929|ES|Marechal Floriano|3203346
2931|ES|Irupi|3202652
2933|ES|São Domingos do Norte|3204658
2935|ES|Vila Pavão|3205150
2937|SP|Lourdes|3527256
2939|SP|Santo Antônio do Aracanguá|3548054
2941|SP|São João de Iracema|3549250
2943|SP|Ilha Solteira|3520442
2945|SP|Suzanápolis|3552551
2947|SP|Canitar|3510153
2949|SP|Engenheiro Coelho|3515152
2951|SP|Hortolândia|3519071
2953|SP|Holambra|3519055
2955|SP|Tuiuti|3554953
2957|SP|Vargem|3556354
2959|SP|Estiva Gerbi|3557303
2961|SP|Emilianópolis|3515129
2963|SP|Pedrinhas Paulista|3537156
2965|SP|Bertioga|3506359
2967|SP|Cajati|3509254
2969|SP|Ilha Comprida|3520426
2971|SP|Ubarana|3555356
2973|SP|Zacarias|3557154
2975|SP|Elisiário|3514924
2977|SP|Marapoama|3528858
2979|SP|Novais|3533254
2981|SP|Aspásia|3503950
2983|SP|Mesópolis|3529658
2985|SP|Nova Canaã Paulista|3532843
2987|SP|Pontalinda|3540259
2989|SP|Parisi|3536257
2991|SP|Arapeí|3503158
2993|SP|Potim|3540754
2995|SP|Alambari|3500758
2997|SP|Barra do Chapéu|3505351
2999|SP|Campina do Monte Alegre|3509452
3001|PE|Fernando de Noronha|2605459
3003|RN|Baraúna|2401453
3005|BA|Muquém do São Francisco|2922250
3007|BA|Nova Fátima|2922730
3009|BA|Nova Ibiá|2922755
3011|BA|Nova Redenção|2922854
3013|BA|Novo Horizonte|2923035
3015|BA|Novo Triunfo|2923050
3017|BA|Ourolândia|2923357
3019|BA|Piraí do Norte|2924678
3021|BA|Ponto Novo|2925253
3023|BA|Presidente Tancredo Neves|2925758
3025|BA|Quixabeira|2925931
3027|BA|Ribeirão do Largo|2926657
3029|BA|São Domingos|2928950
3031|BA|São Félix do Coribe|2929057
3033|BA|São José do Jacuípe|2929370
3035|BA|São José da Vitória|2929354
3037|BA|Saubara|2929750
3039|BA|Serra do Ramalho|2930154
3041|BA|Sítio do Mato|2930758
3043|BA|Sítio do Quinto|2930766
3045|BA|Sobradinho|2930774
3047|BA|Umburanas|2932457
3049|BA|Varzedo|2933174
3051|BA|Vereda|2933257
3053|SP|Itaoca|3522158
3055|SP|Itapirapuã Paulista|3522653
3057|SP|Ribeirão Grande|3543253
3059|SP|Bom Sucesso de Itararé|3507159
3061|SP|Nova Campina|3532827
3063|SP|Taquarivaí|3553856
3065|SP|Alumínio|3501152
3067|SP|Araçariguama|3502754
3069|BA|Jussari|2918555
3071|BA|América Dourada|2901155
3073|BA|Arataca|2902252
3075|BA|Barro Alto|2903235
3079|BA|Buritirama|2904753
3081|BA|Capela do Alto Alegre|2906857
3083|BA|Capim Grosso|2906873
3085|BA|Canudos|2906824
3087|BA|Dias d'Ávila|2910057
3089|BA|Fátima|2910750
3091|BA|Filadélfia|2910859
3093|BA|Gavião|2911253
3095|BA|Guajeru|2911659
3097|BA|Heliópolis|2911857
3099|BA|João Dourado|2918357
3101|SE|Amparo do São Francisco|2800100
3103|SE|Aquidabã|2800209
3105|SE|Aracaju|2800308
3107|SE|Arauá|2800407
3109|SE|Areia Branca|2800506
3111|SE|Barra dos Coqueiros|2800605
3113|SE|Brejo Grande|2800704
3115|SE|Boquim|2800670
3117|BA|Eunápolis|2910727
3119|SE|Campo do Brito|2801009
3121|SE|Canhoba|2801108
3123|SE|Canindé de São Francisco|2801207
3125|SE|Capela|2801306
3127|SE|Carira|2801405
3129|SE|Carmópolis|2801504
3131|SE|Cedro de São João|2801603
3133|SE|Cristinápolis|2801702
3135|SE|Nossa Senhora Aparecida|2804458
3137|SE|Cumbe|2801900
3139|SE|Divina Pastora|2802007
3141|SE|Estância|2802106
3143|SE|Feira Nova|2802205
3145|SE|Frei Paulo|2802304
3147|SE|General Maynard|2802502
3149|SE|Gararu|2802403
3151|SE|Gracho Cardoso|2802601
3153|SE|Ilha das Flores|2802700
3155|SE|Indiaroba|2802809
3157|SE|Itabaiana|2802908
3159|SE|Itabaianinha|2803005
3161|SE|Itabi|2803104
3163|SE|Itaporanga d'Ajuda|2803203
3165|SE|Japaratuba|2803302
3167|SE|Japoatã|2803401
3169|SE|Lagarto|2803500
3171|SE|Laranjeiras|2803609
3173|SE|Macambira|2803708
3175|SE|Malhada dos Bois|2803807
3177|SE|Malhador|2803906
3179|SE|Maruim|2804003
3181|SE|Moita Bonita|2804102
3183|SE|Monte Alegre de Sergipe|2804201
3185|SE|Muribeca|2804300
3187|SE|Neópolis|2804409
3189|SE|Nossa Senhora da Glória|2804508
3191|SE|Nossa Senhora das Dores|2804607
3193|SE|Nossa Senhora de Lourdes|2804706
3195|SE|Nossa Senhora do Socorro|2804805
3197|SE|Pacatuba|2804904
3199|SE|Pedra Mole|2805000
3201|SE|Pedrinhas|2805109
3203|SE|Pinhão|2805208
3205|SE|Pirambu|2805307
3207|SE|Poço Redondo|2805406
3209|SE|Poço Verde|2805505
3211|SE|Porto da Folha|2805604
3213|SE|Propriá|2805703
3215|SE|Riachão do Dantas|2805802
3217|SE|Riachuelo|2805901
3219|SE|Ribeirópolis|2806008
3221|SE|Rosário do Catete|2806107
3223|SE|Salgado|2806206
3225|SE|Santa Luzia do Itanhy|2806305
3227|SP|Torre de Pedra|3554656
3229|SE|Santa Rosa de Lima|2806503
3231|SE|Santo Amaro das Brotas|2806602
3233|SE|São Cristóvão|2806701
3235|SE|São Domingos|2806800
3237|SE|São Francisco|2806909
3239|SE|São Miguel do Aleixo|2807006
3241|SE|Simão Dias|2807105
3243|SE|Siriri|2807204
3245|SE|Telha|2807303
3247|SE|Tobias Barreto|2807402
3249|SE|Tomar do Geru|2807501
3251|SE|Umbaúba|2807600
3253|BA|Adustina|2900355
3255|BA|Andorinha|2901353
3257|BA|Apuarema|2901957
3259|BA|Araçás|2902054
3261|BA|Banzaê|2902658
3263|BA|Bom Jesus da Serra|2903953
3265|BA|Bonito|2904050
3267|BA|Cabaceiras do Paraguaçu|2904852
3269|BA|Caetanos|2905156
3271|BA|Caraíbas|2906899
3273|BA|Caturama|2907558
3275|BA|Feira da Mata|2910776
3277|BA|Igrapiúna|2913457
3279|BA|Itabela|2914653
3281|BA|Itaguaçu da Bahia|2915353
3283|BA|Itatim|2916856
3285|BA|Iuiu|2917334
3287|BA|Jucuruçu|2918456
3289|BA|Lagoa Real|2918753
3291|BA|Lajedo do Tabocal|2919058
3293|BA|Madre de Deus|2919926
3295|BA|Matina|2921054
3297|BA|Mirante|2921450
3299|BA|Mulungu do Morro|2922052
3301|BA|Abaíra|2900108
3303|BA|Abaré|2900207
3305|BA|Acajutiba|2900306
3307|BA|Água Fria|2900405
3309|BA|Érico Cardoso|2900504
3311|BA|Aiquara|2900603
3313|BA|Alagoinhas|2900702
3315|BA|Alcobaça|2900801
3317|BA|Almadina|2900900
3319|BA|Amargosa|2901007
3321|BA|Amélia Rodrigues|2901106
3323|BA|Anagé|2901205
3325|BA|Andaraí|2901304
3327|BA|Angical|2901403
3329|BA|Anguera|2901502
3331|BA|Antas|2901601
3333|BA|Antônio Cardoso|2901700
3335|BA|Antônio Gonçalves|2901809
3337|BA|Aporá|2901908
3339|BA|Aracatu|2902005
3341|BA|Araci|2902104
3343|BA|Aramari|2902203
3345|BA|Aratuípe|2902302
3347|BA|Aurelino Leal|2902401
3349|BA|Baianópolis|2902500
3351|BA|Baixa Grande|2902609
3353|BA|Barra|2902708
3355|BA|Barra da Estiva|2902807
3357|BA|Barra do Choça|2902906
3359|BA|Barra do Mendes|2903003
3361|BA|Barra do Rocha|2903102
3363|BA|Barreiras|2903201
3365|BA|Barro Preto|2903300
3367|BA|Belmonte|2903409
3369|BA|Belo Campo|2903508
3371|BA|Biritinga|2903607
3373|BA|Boa Nova|2903706
3375|BA|Boa Vista do Tupim|2903805
3377|BA|Bom Jesus da Lapa|2903904
3379|BA|Boninal|2904001
3381|BA|Boquira|2904100
3383|BA|Botuporã|2904209
3385|BA|Brejões|2904308
3387|BA|Brejolândia|2904407
3389|BA|Brotas de Macaúbas|2904506
3391|BA|Brumado|2904605
3393|BA|Buerarema|2904704
3395|BA|Caatiba|2904803
3397|BA|Cachoeira|2904902
3399|BA|Caculé|2905008
3401|BA|Caém|2905107
3403|BA|Caetité|2905206
3405|BA|Cafarnaum|2905305
3407|BA|Cairu|2905404
3409|BA|Caldeirão Grande|2905503
3411|BA|Camacan|2905602
3413|BA|Camaçari|2905701
3415|BA|Camamu|2905800
3417|BA|Campo Alegre de Lourdes|2905909
3419|BA|Campo Formoso|2906006
3421|BA|Canápolis|2906105
3423|BA|Canarana|2906204
3425|BA|Canavieiras|2906303
3427|BA|Candeal|2906402
3429|BA|Candeias|2906501
3431|BA|Candiba|2906600
3433|BA|Cândido Sales|2906709
3435|BA|Cansanção|2906808
3437|BA|Caravelas|2906907
3439|BA|Cardeal da Silva|2907004
3441|BA|Carinhanha|2907103
3443|BA|Casa Nova|2907202
3445|BA|Castro Alves|2907301
3447|BA|Catolândia|2907400
3449|BA|Catu|2907509
3451|BA|Central|2907608
3453|BA|Chorrochó|2907707
3455|BA|Cícero Dantas|2907806
3457|BA|Cipó|2907905
3459|BA|Coaraci|2908002
3461|BA|Cocos|2908101
3463|BA|Conceição da Feira|2908200
3465|BA|Conceição do Almeida|2908309
3467|BA|Conceição do Coité|2908408
3469|BA|Conceição do Jacuípe|2908507
3471|BA|Conde|2908606
3473|BA|Condeúba|2908705
3475|BA|Contendas do Sincorá|2908804
3477|BA|Coração de Maria|2908903
3479|BA|Cordeiros|2909000
3481|BA|Coribe|2909109
3483|BA|Coronel João Sá|2909208
3485|BA|Correntina|2909307
3487|BA|Cotegipe|2909406
3489|BA|Cravolândia|2909505
3491|BA|Crisópolis|2909604
3493|BA|Cristópolis|2909703
3495|BA|Cruz das Almas|2909802
3497|BA|Curaçá|2909901
3499|BA|Dário Meira|2910008
3501|BA|Dom Basílio|2910107
3503|BA|Dom Macedo Costa|2910206
3505|BA|Elísio Medrado|2910305
3507|BA|Encruzilhada|2910404
3509|BA|Entre Rios|2910503
3511|BA|Esplanada|2910602
3513|BA|Euclides da Cunha|2910701
3515|BA|Feira de Santana|2910800
3517|BA|Firmino Alves|2910909
3519|BA|Floresta Azul|2911006
3521|BA|Formosa do Rio Preto|2911105
3523|BA|Gandu|2911204
3525|BA|Gentio do Ouro|2911303
3527|BA|Glória|2911402
3529|BA|Gongogi|2911501
3531|BA|Governador Mangabeira|2911600
3533|BA|Guanambi|2911709
3535|BA|Guaratinga|2911808
3537|BA|Iaçu|2911907
3539|BA|Ibiassucê|2912004
3541|BA|Ibicaraí|2912103
3543|BA|Ibicoara|2912202
3545|BA|Ibicuí|2912301
3547|BA|Ibipeba|2912400
3549|BA|Santa Rita de Cássia|2928406
3551|BA|Ibipitanga|2912509
3553|BA|Ibiquera|2912608
3555|BA|Ibirapitanga|2912707
3557|BA|Ibirapuã|2912806
3559|BA|Ibirataia|2912905
3561|BA|Ibitiara|2913002
3563|BA|Ibititá|2913101
3565|BA|Ibotirama|2913200
3567|BA|Ichu|2913309
3569|BA|Igaporã|2913408
3571|BA|Iguaí|2913507
3573|BA|Ilhéus|2913606
3575|BA|Inhambupe|2913705
3577|BA|Ipecaetá|2913804
3579|BA|Ipiaú|2913903
3581|BA|Ipirá|2914000
3583|BA|Ipupiara|2914109
3585|BA|Irajuba|2914208
3587|BA|Iramaia|2914307
3589|BA|Iraquara|2914406
3591|BA|Irará|2914505
3593|BA|Irecê|2914604
3595|BA|Itaberaba|2914703
3597|BA|Itabuna|2914802
3599|BA|Itacaré|2914901
3601|BA|Itaeté|2915007
3603|BA|Itagi|2915106
3605|BA|Itagibá|2915205
3607|BA|Itagimirim|2915304
3609|BA|Itaju do Colônia|2915403
3611|BA|Itajuípe|2915502
3613|BA|Itamaraju|2915601
3615|BA|Itamari|2915700
3617|BA|Itambé|2915809
3619|BA|Itanagra|2915908
3621|BA|Itanhém|2916005
3623|BA|Itaparica|2916104
3625|BA|Itapé|2916203
3627|BA|Itapebi|2916302
3629|BA|Itapetinga|2916401
3631|BA|Itapicuru|2916500
3633|BA|Itapitanga|2916609
3635|BA|Itaquara|2916708
3637|BA|Itarantim|2916807
3639|BA|Itiruçu|2916906
3641|BA|Itiúba|2917003
3643|BA|Itororó|2917102
3645|BA|Ituaçu|2917201
3647|BA|Ituberá|2917300
3649|BA|Jacaraci|2917409
3651|BA|Jacobina|2917508
3653|BA|Jaguaquara|2917607
3655|BA|Jaguarari|2917706
3657|BA|Jaguaripe|2917805
3659|BA|Jandaíra|2917904
3661|BA|Jequié|2918001
3663|BA|Jeremoabo|2918100
3665|BA|Jiquiriçá|2918209
3667|BA|Jitaúna|2918308
3669|BA|Juazeiro|2918407
3671|BA|Jussara|2918506
3673|BA|Jussiape|2918605
3675|BA|Lafaiete Coutinho|2918704
3677|BA|Laje|2918803
3679|BA|Lajedão|2918902
3681|BA|Lajedinho|2919009
3683|BA|Lamarão|2919108
3685|BA|Lauro de Freitas|2919207
3687|BA|Lençóis|2919306
3689|BA|Licínio de Almeida|2919405
3691|BA|Livramento de Nossa Senhora|2919504
3693|BA|Macajuba|2919603
3695|BA|Macarani|2919702
3697|BA|Macaúbas|2919801
3699|BA|Macururé|2919900
3701|BA|Maiquinique|2920007
3703|BA|Mairi|2920106
3705|BA|Malhada|2920205
3707|BA|Malhada de Pedras|2920304
3709|BA|Manoel Vitorino|2920403
3711|BA|Maracás|2920502
3713|BA|Maragogipe|2920601
3715|BA|Maraú|2920700
3717|BA|Marcionílio Souza|2920809
3719|BA|Mascote|2920908
3721|BA|Mata de São João|2921005
3723|BA|Medeiros Neto|2921104
3725|BA|Miguel Calmon|2921203
3727|BA|Milagres|2921302
3729|BA|Mirangaba|2921401
3731|BA|Monte Santo|2921500
3733|BA|Morpará|2921609
3735|BA|Morro do Chapéu|2921708
3737|BA|Mortugaba|2921807
3739|BA|Mucugê|2921906
3741|BA|Mucuri|2922003
3743|BA|Mundo Novo|2922102
3745|BA|Muniz Ferreira|2922201
3747|BA|Muritiba|2922300
3749|BA|Mutuípe|2922409
3751|BA|Nazaré|2922508
3753|BA|Nilo Peçanha|2922607
3755|BA|Nova Canaã|2922706
3757|BA|Nova Itarana|2922805
3759|BA|Nova Soure|2922904
3761|BA|Nova Viçosa|2923001
3763|BA|Olindina|2923100
3765|BA|Oliveira dos Brejinhos|2923209
3767|BA|Ouriçangas|2923308
3769|BA|Palmas de Monte Alto|2923407
3771|BA|Palmeiras|2923506
3773|BA|Paramirim|2923605
3775|BA|Paratinga|2923704
3777|BA|Paripiranga|2923803
3779|BA|Pau Brasil|2923902
3781|BA|Paulo Afonso|2924009
3783|BA|Pedrão|2924108
3785|BA|Pedro Alexandre|2924207
3787|BA|Piatã|2924306
3789|BA|Pilão Arcado|2924405
3791|BA|Pindaí|2924504
3793|BA|Pindobaçu|2924603
3795|BA|Piripá|2924702
3797|BA|Piritiba|2924801
3799|BA|Planaltino|2924900
3801|BA|Planalto|2925006
3803|BA|Poções|2925105
3805|BA|Pojuca|2925204
3807|BA|Porto Seguro|2925303
3809|BA|Potiraguá|2925402
3811|BA|Prado|2925501
3813|BA|Presidente Dutra|2925600
3815|BA|Presidente Jânio Quadros|2925709
3817|BA|Queimadas|2925808
3819|BA|Quijingue|2925907
3821|BA|Remanso|2926004
3823|BA|Retirolândia|2926103
3825|BA|Riachão das Neves|2926202
3827|BA|Riachão do Jacuípe|2926301
3829|BA|Riacho de Santana|2926400
3831|BA|Ribeira do Amparo|2926509
3833|BA|Ribeira do Pombal|2926608
3835|BA|Rio de Contas|2926707
3837|BA|Rio do Antônio|2926806
3839|BA|Rio do Pires|2926905
3841|BA|Rio Real|2927002
3843|BA|Rodelas|2927101
3845|BA|Ruy Barbosa|2927200
3847|BA|Salinas da Margarida|2927309
3849|BA|Salvador|2927408
3851|BA|Santa Bárbara|2927507
3853|BA|Santa Brígida|2927606
3855|BA|Santa Cruz Cabrália|2927705
3857|BA|Santa Cruz da Vitória|2927804
3859|BA|Santa Inês|2927903
3861|BA|Santaluz|2928000
3863|BA|Santa Maria da Vitória|2928109
3865|BA|Santana|2928208
3867|BA|Santanópolis|2928307
3869|BA|Santa Terezinha|2928505
3871|BA|Santo Amaro|2928604
3873|BA|Santo Antônio de Jesus|2928703
3875|BA|Santo Estêvão|2928802
3877|BA|São Desidério|2928901
3879|BA|São Félix|2929008
3881|BA|São Felipe|2929107
3883|BA|São Francisco do Conde|2929206
3885|BA|São Gonçalo dos Campos|2929305
3887|BA|São Miguel das Matas|2929404
3889|BA|São Sebastião do Passé|2929503
3891|BA|Sapeaçu|2929602
3893|BA|Sátiro Dias|2929701
3895|BA|Saúde|2929800
3897|BA|Seabra|2929909
3899|BA|Sebastião Laranjeiras|2930006
3901|BA|Senhor do Bonfim|2930105
3903|BA|Sento Sé|2930204
3905|BA|Serra Dourada|2930303
3907|BA|Serra Preta|2930402
3909|BA|Serrinha|2930501
3911|BA|Serrolândia|2930600
3913|BA|Simões Filho|2930709
3915|BA|Souto Soares|2930808
3917|BA|Tabocas do Brejo Velho|2930907
3919|BA|Tanhaçu|2931004
3921|BA|Tanquinho|2931103
3923|BA|Taperoá|2931202
3925|BA|Tapiramutá|2931301
3927|BA|Teodoro Sampaio|2931400
3929|BA|Teofilândia|2931509
3931|BA|Teolândia|2931608
3933|BA|Terra Nova|2931707
3935|BA|Tremedal|2931806
3937|BA|Tucano|2931905
3939|BA|Uauá|2932002
3941|BA|Ubaíra|2932101
3943|BA|Ubaitaba|2932200
3945|BA|Ubatã|2932309
3947|BA|Uibaí|2932408
3949|BA|Una|2932507
3951|BA|Urandi|2932606
3953|BA|Uruçuca|2932705
3955|BA|Utinga|2932804
3957|BA|Valença|2932903
3959|BA|Valente|2933000
3961|BA|Várzea do Poço|2933109
3963|BA|Vera Cruz|2933208
3965|BA|Vitória da Conquista|2933307
3967|BA|Wagner|2933406
3969|BA|Wenceslau Guimarães|2933505
3971|BA|Xique-Xique|2933604
3973|BA|Lapão|2919157
3975|BA|Maetinga|2919959
3977|BA|Mansidão|2920452
3979|BA|Nordestina|2922656
3981|BA|Pé de Serra|2924058
3983|BA|Pintadas|2924652
3985|BA|Rafael Jambeiro|2925956
3987|BA|Santa Luzia|2928059
3989|BA|São Gabriel|2929255
3991|BA|Tanque Novo|2931053
3993|BA|Teixeira de Freitas|2931350
3995|BA|Várzea Nova|2933158
3997|BA|Várzea da Roça|2933059
3999|BA|Wanderley|2933455
4001|MG|Abadia dos Dourados|3100104
4003|MG|Abaeté|3100203
4005|MG|Abre Campo|3100302
4007|MG|Acaiaca|3100401
4009|MG|Açucena|3100500
4011|MG|Água Boa|3100609
4013|MG|Água Comprida|3100708
4015|MG|Aguanil|3100807
4017|MG|Águas Formosas|3100906
4019|MG|Águas Vermelhas|3101003
4021|MG|Aimorés|3101102
4023|MG|Aiuruoca|3101201
4025|MG|Alagoa|3101300
4027|MG|Albertina|3101409
4029|MG|Além Paraíba|3101508
4031|MG|Alfenas|3101607
4033|MG|Almenara|3101706
4035|MG|Alpercata|3101805
4037|MG|Alpinópolis|3101904
4039|MG|Alterosa|3102001
4041|MG|Alto Rio Doce|3102100
4043|MG|Alvarenga|3102209
4045|MG|Alvinópolis|3102308
4047|MG|Alvorada de Minas|3102407
4049|MG|Amparo do Serra|3102506
4051|MG|Andradas|3102605
4053|MG|Cachoeira de Pajeú|3102704
4055|MG|Andrelândia|3102803
4057|MG|Antônio Carlos|3102902
4059|MG|Antônio Dias|3103009
4061|MG|Antônio Prado de Minas|3103108
4063|MG|Araçaí|3103207
4065|MG|Aracitaba|3103306
4067|MG|Araçuaí|3103405
4069|MG|Araguari|3103504
4071|MG|Arantina|3103603
4073|MG|Araponga|3103702
4075|MG|Arapuá|3103801
4077|MG|Araújos|3103900
4079|MG|Araxá|3104007
4081|MG|Arceburgo|3104106
4083|MG|Arcos|3104205
4085|MG|Areado|3104304
4087|MG|Argirita|3104403
4089|MG|Arinos|3104502
4091|MG|Astolfo Dutra|3104601
4093|MG|Ataléia|3104700
4095|MG|Augusto de Lima|3104809
4097|MG|Baependi|3104908
4099|MG|Baldim|3105004
4101|MG|Bambuí|3105103
4103|MG|Bandeira|3105202
4105|MG|Bandeira do Sul|3105301
4107|MG|Barão de Cocais|3105400
4109|MG|Barão de Monte Alto|3105509
4111|MG|Barbacena|3105608
4113|MG|Barra Longa|3105707
4115|MG|Três Marias|3169356
4117|MG|Barroso|3105905
4119|MG|Bela Vista de Minas|3106002
4121|MG|Belmiro Braga|3106101
4123|MG|Belo Horizonte|3106200
4125|MG|Belo Oriente|3106309
4127|MG|Belo Vale|3106408
4129|MG|Berilo|3106507
4131|MG|Bertópolis|3106606
4133|MG|Betim|3106705
4135|MG|Bias Fortes|3106804
4137|MG|Bicas|3106903
4139|MG|Biquinhas|3107000
4141|MG|Boa Esperança|3107109
4143|MG|Bocaina de Minas|3107208
4145|MG|Bocaiúva|3107307
4147|MG|Bom Despacho|3107406
4149|MG|Bom Jardim de Minas|3107505
4151|MG|Bom Jesus da Penha|3107604
4153|MG|Bom Jesus do Amparo|3107703
4155|MG|Bom Jesus do Galho|3107802
4157|MG|Bom Repouso|3107901
4159|MG|Bom Sucesso|3108008
4161|MG|Bonfim|3108107
4163|MG|Bonfinópolis de Minas|3108206
4165|MG|Borda da Mata|3108305
4167|MG|Botelhos|3108404
4169|MG|Botumirim|3108503
4171|MG|Brasília de Minas|3108602
4173|MG|Brás Pires|3108701
4175|MG|Braúnas|3108800
4177|MG|Brazópolis|3108909
4179|MG|Brumadinho|3109006
4181|MG|Bueno Brandão|3109105
4183|MG|Buenópolis|3109204
4185|MG|Buritis|3109303
4187|MG|Buritizeiro|3109402
4189|MG|Cabo Verde|3109501
4191|MG|Cachoeira da Prata|3109600
4193|MG|Cachoeira de Minas|3109709
4195|MG|Cachoeira Dourada|3109808
4197|MG|Caetanópolis|3109907
4199|MG|Caeté|3110004
4201|MG|Caiana|3110103
4203|MG|Cajuri|3110202
4205|MG|Caldas|3110301
4207|MG|Camacho|3110400
4209|MG|Camanducaia|3110509
4211|MG|Cambuí|3110608
4213|MG|Cambuquira|3110707
4215|MG|Campanário|3110806
4217|MG|Campanha|3110905
4219|MG|Campestre|3111002
4221|MG|Campina Verde|3111101
4223|MG|Campo Belo|3111200
4225|MG|Campo do Meio|3111309
4227|MG|Campo Florido|3111408
4229|MG|Campos Altos|3111507
4231|MG|Campos Gerais|3111606
4233|MG|Canaã|3111705
4235|MG|Canápolis|3111804
4237|MG|Cana Verde|3111903
4239|MG|Candeias|3112000
4241|MG|Caparaó|3112109
4243|MG|Capela Nova|3112208
4245|MG|Capelinha|3112307
4247|MG|Capetinga|3112406
4249|MG|Capim Branco|3112505
4251|MG|Capinópolis|3112604
4253|MG|Capitão Enéas|3112703
4255|MG|Capitólio|3112802
4257|MG|Caputira|3112901
4259|MG|Caraí|3113008
4261|MG|Caranaíba|3113107
4263|MG|Carandaí|3113206
4265|MG|Carangola|3113305
4267|MG|Caratinga|3113404
4269|MG|Carbonita|3113503
4271|MG|Careaçu|3113602
4273|MG|Carlos Chagas|3113701
4275|MG|Carmésia|3113800
4277|MG|Carmo da Cachoeira|3113909
4279|MG|Carmo da Mata|3114006
4281|MG|Carmo de Minas|3114105
4283|MG|Carmo do Cajuru|3114204
4285|MG|Carmo do Paranaíba|3114303
4287|MG|Carmo do Rio Claro|3114402
4289|MG|Carmópolis de Minas|3114501
4291|MG|Carrancas|3114600
4293|MG|Carvalhópolis|3114709
4295|MG|Carvalhos|3114808
4297|MG|Casa Grande|3114907
4299|MG|Cascalho Rico|3115003
4301|MG|Cássia|3115102
4303|MG|Conceição da Barra de Minas|3115201
4305|MG|Cataguases|3115300
4307|MG|Catas Altas da Noruega|3115409
4309|MG|Caxambu|3115508
4311|MG|Cedro do Abaeté|3115607
4313|MG|Central de Minas|3115706
4315|MG|Centralina|3115805
4317|MG|Chácara|3115904
4319|MG|Chalé|3116001
4321|MG|Chapada do Norte|3116100
4323|MG|Chiador|3116209
4325|MG|Cipotânea|3116308
4327|MG|Claraval|3116407
4329|MG|Claro dos Poções|3116506
4331|MG|Cláudio|3116605
4333|MG|Coimbra|3116704
4335|MG|Coluna|3116803
4337|MG|Comendador Gomes|3116902
4339|MG|Comercinho|3117009
4341|MG|Conceição da Aparecida|3117108
4343|MG|Conceição das Pedras|3117207
4345|MG|Conceição das Alagoas|3117306
4347|MG|Conceição de Ipanema|3117405
4349|MG|Conceição do Mato Dentro|3117504
4351|MG|Conceição do Pará|3117603
4353|MG|Conceição do Rio Verde|3117702
4355|MG|Conceição dos Ouros|3117801
4357|MG|Congonhal|3117900
4359|MG|Congonhas|3118007
4361|MG|Congonhas do Norte|3118106
4363|MG|Conquista|3118205
4365|MG|Conselheiro Lafaiete|3118304
4367|MG|Conselheiro Pena|3118403
4369|MG|Consolação|3118502
4371|MG|Contagem|3118601
4373|MG|Coqueiral|3118700
4375|MG|Coração de Jesus|3118809
4377|MG|Cordisburgo|3118908
4379|MG|Cordislândia|3119005
4381|MG|Corinto|3119104
4383|MG|Coroaci|3119203
4385|MG|Coromandel|3119302
4387|MG|Coronel Fabriciano|3119401
4389|MG|Coronel Murta|3119500
4391|MG|Coronel Pacheco|3119609
4393|MG|Coronel Xavier Chaves|3119708
4395|MG|Córrego Danta|3119807
4397|MG|Córrego do Bom Jesus|3119906
4399|MG|Córrego Novo|3120003
4401|MG|Couto de Magalhães de Minas|3120102
4403|MG|Cristais|3120201
4405|MG|Cristália|3120300
4407|MG|Cristiano Otoni|3120409
4409|MG|Cristina|3120508
4411|MG|Crucilândia|3120607
4413|MG|Cruzeiro da Fortaleza|3120706
4415|MG|Cruzília|3120805
4417|MG|Curvelo|3120904
4419|MG|Datas|3121001
4421|MG|Delfim Moreira|3121100
4423|MG|Delfinópolis|3121209
4425|MG|Descoberto|3121308
4427|MG|Desterro de Entre Rios|3121407
4429|MG|Desterro do Melo|3121506
4431|MG|Diamantina|3121605
4433|MG|Diogo de Vasconcelos|3121704
4435|MG|Dionísio|3121803
4437|MG|Divinésia|3121902
4439|MG|Divino|3122009
4441|MG|Divino das Laranjeiras|3122108
4443|MG|Divinolândia de Minas|3122207
4445|MG|Divinópolis|3122306
4447|MG|Divisa Nova|3122405
4449|MG|Dom Cavati|3122504
4451|MG|Dom Joaquim|3122603
4453|MG|Dom Silvério|3122702
4455|MG|Dom Viçoso|3122801
4457|MG|Dona Euzébia|3122900
4459|MG|Dores de Campos|3123007
4461|MG|Dores de Guanhães|3123106
4463|MG|Dores do Indaiá|3123205
4465|MG|Dores do Turvo|3123304
4467|MG|Doresópolis|3123403
4469|MG|Douradoquara|3123502
4471|MG|Elói Mendes|3123601
4473|MG|Engenheiro Caldas|3123700
4475|MG|Engenheiro Navarro|3123809
4477|MG|Entre Rios de Minas|3123908
4479|MG|Ervália|3124005
4481|MG|Esmeraldas|3124104
4483|MG|Espera Feliz|3124203
4485|MG|Espinosa|3124302
4487|MG|Espírito Santo do Dourado|3124401
4489|MG|Estiva|3124500
4491|MG|Estrela Dalva|3124609
4493|MG|Estrela do Indaiá|3124708
4495|MG|Estrela do Sul|3124807
4497|MG|Eugenópolis|3124906
4499|MG|Ewbank da Câmara|3125002
4501|MG|Extrema|3125101
4503|MG|Fama|3125200
4505|MG|Faria Lemos|3125309
4507|MG|Felício dos Santos|3125408
4509|MG|São Gonçalo do Rio Preto|3125507
4511|MG|Felisburgo|3125606
4513|MG|Felixlândia|3125705
4515|MG|Fernandes Tourinho|3125804
4517|MG|Ferros|3125903
4519|MG|Florestal|3126000
4521|MG|Formiga|3126109
4523|MG|Formoso|3126208
4525|MG|Fortaleza de Minas|3126307
4527|MG|Fortuna de Minas|3126406
4529|MG|Francisco Badaró|3126505
4531|MG|Francisco Dumont|3126604
4533|MG|Francisco Sá|3126703
4535|MG|Frei Gaspar|3126802
4537|MG|Frei Inocêncio|3126901
4539|MG|Fronteira|3127008
4541|MG|Frutal|3127107
4543|MG|Funilândia|3127206
4545|MG|Galiléia|3127305
4547|MG|Gonçalves|3127404
4549|MG|Gonzaga|3127503
4551|MG|Gouveia|3127602
4553|MG|Governador Valadares|3127701
4555|MG|Grão Mogol|3127800
4557|MG|Grupiara|3127909
4559|MG|Guanhães|3128006
4561|MG|Guapé|3128105
4563|MG|Guaraciaba|3128204
4565|MG|Guaranésia|3128303
4567|MG|Guarani|3128402
4569|MG|Guarará|3128501
4571|MG|Guarda-Mor|3128600
4573|MG|Guaxupé|3128709
4575|MG|Guidoval|3128808
4577|MG|Guimarânia|3128907
4579|MG|Guiricema|3129004
4581|MG|Gurinhatã|3129103
4583|MG|Heliodora|3129202
4585|MG|Iapu|3129301
4587|MG|Ibertioga|3129400
4589|MG|Ibiá|3129509
4591|MG|Ibiaí|3129608
4593|MG|Ibiraci|3129707
4595|MG|Ibirité|3129806
4597|MG|Ibitiúra de Minas|3129905
4599|MG|Ibituruna|3130002
4601|MG|Igarapé|3130101
4603|MG|Igaratinga|3130200
4605|MG|Iguatama|3130309
4607|MG|Ijaci|3130408
4609|MG|Ilicínea|3130507
4611|MG|Inconfidentes|3130606
4613|MG|Indianópolis|3130705
4615|MG|Ingaí|3130804
4617|MG|Inhapim|3130903
4619|MG|Inhaúma|3131000
4621|MG|Inimutaba|3131109
4623|MG|Ipanema|3131208
4625|MG|Ipatinga|3131307
4627|MG|Ipiaçu|3131406
4629|MG|Ipuiúna|3131505
4631|MG|Iraí de Minas|3131604
4633|MG|Itabira|3131703
4635|MG|Itabirinha|3131802
4637|MG|Itabirito|3131901
4639|MG|Itacambira|3132008
4641|MG|Itacarambi|3132107
4643|MG|Itaguara|3132206
4645|MG|Itaipé|3132305
4647|MG|Itajubá|3132404
4649|MG|Itamarandiba|3132503
4651|MG|Itamarati de Minas|3132602
4653|MG|Itambacuri|3132701
4655|MG|Itambé do Mato Dentro|3132800
4657|MG|Itamogi|3132909
4659|MG|Itamonte|3133006
4661|MG|Itanhandu|3133105
4663|MG|Itanhomi|3133204
4665|MG|Itaobim|3133303
4667|MG|Itapagipe|3133402
4669|MG|Itapecerica|3133501
4671|MG|Itapeva|3133600
4673|MG|Itatiaiuçu|3133709
4675|MG|Itaúna|3133808
4677|MG|Itaverava|3133907
4679|MG|Itinga|3134004
4681|MG|Itueta|3134103
4683|MG|Ituiutaba|3134202
4685|MG|Itumirim|3134301
4687|MG|Iturama|3134400
4689|MG|Itutinga|3134509
4691|MG|Jaboticatubas|3134608
4693|MG|Jacinto|3134707
4695|MG|Jacuí|3134806
4697|MG|Jacutinga|3134905
4699|MG|Jaguaraçu|3135001
4701|MG|Janaúba|3135100
4703|MG|Januária|3135209
4705|MG|Japaraíba|3135308
4707|MG|Jeceaba|3135407
4709|MG|Jequeri|3135506
4711|MG|Jequitaí|3135605
4713|MG|Jequitibá|3135704
4715|MG|Jequitinhonha|3135803
4717|MG|Jesuânia|3135902
4719|MG|Joaíma|3136009
4721|MG|Joanésia|3136108
4723|MG|João Monlevade|3136207
4725|MG|João Pinheiro|3136306
4727|MG|Joaquim Felício|3136405
4729|MG|Jordânia|3136504
4731|MG|Nova União|3136603
4733|MG|Juiz de Fora|3136702
4735|MG|Juramento|3136801
4737|MG|Juruaia|3136900
4739|MG|Ladainha|3137007
4741|MG|Lagamar|3137106
4743|MG|Lagoa da Prata|3137205
4745|MG|Lagoa dos Patos|3137304
4747|MG|Lagoa Dourada|3137403
4749|MG|Lagoa Formosa|3137502
4751|MG|Lagoa Santa|3137601
4753|MG|Lajinha|3137700
4755|MG|Lambari|3137809
4757|MG|Lamim|3137908
4759|MG|Laranjal|3138005
4761|MG|Lassance|3138104
4763|MG|Lavras|3138203
4765|MG|Leandro Ferreira|3138302
4767|MG|Leopoldina|3138401
4769|MG|Liberdade|3138500
4771|MG|Lima Duarte|3138609
4773|MG|Luminárias|3138708
4775|MG|Luz|3138807
4777|MG|Machacalis|3138906
4779|MG|Machado|3139003
4781|MG|Madre de Deus de Minas|3139102
4783|MG|Malacacheta|3139201
4785|MG|Manga|3139300
4787|MG|Manhuaçu|3139409
4789|MG|Manhumirim|3139508
4791|MG|Mantena|3139607
4793|MG|Maravilhas|3139706
4795|MG|Mar de Espanha|3139805
4797|MG|Maria da Fé|3139904
4799|MG|Mariana|3140001
4801|MG|Marilac|3140100
4803|MG|Maripá de Minas|3140209
4805|MG|Marliéria|3140308
4807|MG|Marmelópolis|3140407
4809|MG|Martinho Campos|3140506
4811|MG|Materlândia|3140605
4813|MG|Mateus Leme|3140704
4815|MG|Matias Barbosa|3140803
4817|MG|Matipó|3140902
4819|MG|Mato Verde|3141009
4821|MG|Matozinhos|3141108
4823|MG|Matutina|3141207
4825|MG|Medeiros|3141306
4827|MG|Medina|3141405
4829|MG|Mendes Pimentel|3141504
4831|MG|Mercês|3141603
4833|MG|Mesquita|3141702
4835|MG|Minas Novas|3141801
4837|MG|Minduri|3141900
4839|MG|Mirabela|3142007
4841|MG|Miradouro|3142106
4843|MG|Miraí|3142205
4845|MG|Moeda|3142304
4847|MG|Moema|3142403
4849|MG|Monjolos|3142502
4851|MG|Monsenhor Paulo|3142601
4853|MG|Montalvânia|3142700
4855|MG|Monte Alegre de Minas|3142809
4857|MG|Monte Azul|3142908
4859|MG|Monte Belo|3143005
4861|MG|Monte Carmelo|3143104
4863|MG|Monte Santo de Minas|3143203
4865|MG|Montes Claros|3143302
4867|MG|Monte Sião|3143401
4869|MG|Morada Nova de Minas|3143500
4871|MG|Morro da Garça|3143609
4873|MG|Morro do Pilar|3143708
4875|MG|Munhoz|3143807
4877|MG|Muriaé|3143906
4879|MG|Mutum|3144003
4881|MG|Muzambinho|3144102
4883|MG|Nacip Raydan|3144201
4885|MG|Nanuque|3144300
4887|MG|Natércia|3144409
4889|MG|Nazareno|3144508
4891|MG|Nepomuceno|3144607
4893|MG|Nova Era|3144706
4895|MG|Nova Lima|3144805
4897|MG|Nova Módica|3144904
4899|MG|Nova Ponte|3145000
4901|MG|Nova Resende|3145109
4903|MG|Nova Serrana|3145208
4905|MG|Novo Cruzeiro|3145307
4907|MG|Olaria|3145406
4909|MG|Olímpio Noronha|3145505
4911|MG|Oliveira|3145604
4913|MG|Oliveira Fortes|3145703
4915|MG|Onça de Pitangui|3145802
4917|MG|Ouro Branco|3145901
4919|MG|Ouro Fino|3146008
4921|MG|Ouro Preto|3146107
4923|MG|Ouro Verde de Minas|3146206
4925|MG|Padre Paraíso|3146305
4927|MG|Paineiras|3146404
4929|MG|Pains|3146503
4931|MG|Paiva|3146602
4933|MG|Palma|3146701
4935|MG|Fronteira dos Vales|3127057
4937|MG|Papagaios|3146909
4939|MG|Paracatu|3147006
4941|MG|Pará de Minas|3147105
4943|MG|Paraguaçu|3147204
4945|MG|Paraisópolis|3147303
4947|MG|Paraopeba|3147402
4949|MG|Passabém|3147501
4951|MG|Passa Quatro|3147600
4953|MG|Passa Tempo|3147709
4955|MG|Passa Vinte|3147808
4957|MG|Passos|3147907
4959|MG|Patos de Minas|3148004
4961|MG|Patrocínio|3148103
4963|MG|Patrocínio do Muriaé|3148202
4965|MG|Paula Cândido|3148301
4967|MG|Paulistas|3148400
4969|MG|Pavão|3148509
4971|MG|Peçanha|3148608
4973|MG|Pedra Azul|3148707
4975|MG|Pedra do Anta|3148806
4977|MG|Pedra do Indaiá|3148905
4979|MG|Pedra Dourada|3149002
4981|MG|Pedralva|3149101
4983|MG|Pedrinópolis|3149200
4985|MG|Pedro Leopoldo|3149309
4987|MG|Pedro Teixeira|3149408
4989|MG|Pequeri|3149507
4991|MG|Pequi|3149606
4993|MG|Perdigão|3149705
4995|MG|Perdizes|3149804
4997|MG|Perdões|3149903
4999|MG|Pescador|3150000
5001|MG|Piau|3150109
5003|MG|Piedade de Ponte Nova|3150208
5005|MG|Piedade do Rio Grande|3150307
5007|MG|Piedade dos Gerais|3150406
5009|MG|Pimenta|3150505
5011|MG|Piracema|3150604
5013|MG|Pirajuba|3150703
5015|MG|Piranga|3150802
5017|MG|Piranguçu|3150901
5019|MG|Piranguinho|3151008
5021|MG|Pirapetinga|3151107
5023|MG|Pirapora|3151206
5025|MG|Piraúba|3151305
5027|MG|Pitangui|3151404
5029|MG|Piumhi|3151503
5031|MG|Planura|3151602
5033|MG|Poço Fundo|3151701
5035|MG|Poços de Caldas|3151800
5037|MG|Pocrane|3151909
5039|MG|Pompéu|3152006
5041|MG|Ponte Nova|3152105
5043|MG|Porteirinha|3152204
5045|MG|Porto Firme|3152303
5047|MG|Poté|3152402
5049|MG|Pouso Alegre|3152501
5051|MG|Pouso Alto|3152600
5053|MG|Prados|3152709
5055|MG|Prata|3152808
5057|MG|Pratápolis|3152907
5059|MG|Pratinha|3153004
5061|MG|Presidente Bernardes|3153103
5063|MG|Presidente Juscelino|3153202
5065|MG|Presidente Kubitschek|3153301
5067|MG|Presidente Olegário|3153400
5069|MG|Alto Jequitibá|3153509
5071|MG|Prudente de Morais|3153608
5073|MG|Quartel Geral|3153707
5075|MG|Queluzito|3153806
5077|MG|Raposos|3153905
5079|MG|Raul Soares|3154002
5081|MG|Recreio|3154101
5083|MG|Resende Costa|3154200
5085|MG|Resplendor|3154309
5087|MG|Ressaquinha|3154408
5089|MG|Riacho dos Machados|3154507
5091|MG|Ribeirão das Neves|3154606
5093|MG|Ribeirão Vermelho|3154705
5095|MG|Rio Acima|3154804
5097|MG|Rio Casca|3154903
5099|MG|Rio Doce|3155009
5101|MG|Rio do Prado|3155108
5103|MG|Rio Espera|3155207
5105|MG|Rio Manso|3155306
5107|MG|Rio Novo|3155405
5109|MG|Rio Paranaíba|3155504
5111|MG|Rio Pardo de Minas|3155603
5113|MG|Rio Piracicaba|3155702
5115|MG|Rio Pomba|3155801
5117|MG|Rio Preto|3155900
5119|MG|Rio Vermelho|3156007
5121|MG|Ritápolis|3156106
5123|MG|Rochedo de Minas|3156205
5125|MG|Rodeiro|3156304
5127|MG|Romaria|3156403
5129|MG|Rubelita|3156502
5131|MG|Rubim|3156601
5133|MG|Sabará|3156700
5135|MG|Sabinópolis|3156809
5137|MG|Sacramento|3156908
5139|MG|Salinas|3157005
5141|MG|Salto da Divisa|3157104
5143|MG|Santa Bárbara|3157203
5145|MG|Santa Bárbara do Tugúrio|3157302
5147|MG|Santa Cruz do Escalvado|3157401
5149|MG|Santa Efigênia de Minas|3157500
5151|MG|Santa Fé de Minas|3157609
5153|MG|Santa Juliana|3157708
5155|MG|Santa Luzia|3157807
5157|MG|Santa Margarida|3157906
5159|MG|Santa Maria de Itabira|3158003
5161|MG|Santa Maria do Salto|3158102
5163|MG|Santa Maria do Suaçuí|3158201
5165|MG|Santana da Vargem|3158300
5167|MG|Santana de Cataguases|3158409
5169|MG|Santana de Pirapama|3158508
5171|MG|Santana do Deserto|3158607
5173|MG|Santana do Garambéu|3158706
5175|MG|Santana do Jacaré|3158805
5177|MG|Santana do Manhuaçu|3158904
5179|MG|Santana do Riacho|3159001
5181|MG|Santana dos Montes|3159100
5183|MG|Santa Rita de Caldas|3159209
5185|MG|Santa Rita de Jacutinga|3159308
5187|MG|Santa Rita de Ibitipoca|3159407
5189|MG|Santa Rita do Itueto|3159506
5191|MG|Santa Rita do Sapucaí|3159605
5193|MG|Santa Rosa da Serra|3159704
5195|MG|Santa Vitória|3159803
5197|MG|Santo Antônio do Amparo|3159902
5199|MG|Santo Antônio do Aventureiro|3160009
5201|MG|Santo Antônio do Grama|3160108
5203|MG|Santo Antônio do Itambé|3160207
5205|MG|Santo Antônio do Jacinto|3160306
5207|MG|Santo Antônio do Monte|3160405
5209|MG|Santo Antônio do Rio Abaixo|3160504
5211|MG|Santo Hipólito|3160603
5213|MG|Santos Dumont|3160702
5215|MG|São Bento Abade|3160801
5217|MG|São Brás do Suaçuí|3160900
5219|MG|São Domingos do Prata|3161007
5221|MG|São Francisco|3161106
5223|MG|São Francisco de Paula|3161205
5225|MG|São Francisco de Sales|3161304
5227|MG|São Francisco do Glória|3161403
5229|MG|São Geraldo|3161502
5231|MG|São Geraldo da Piedade|3161601
5233|MG|São Gonçalo do Abaeté|3161700
5235|MG|São Gonçalo do Pará|3161809
5237|MG|São Gonçalo do Rio Abaixo|3161908
5239|MG|São Gonçalo do Sapucaí|3162005
5241|MG|São Gotardo|3162104
5243|MG|São João Batista do Glória|3162203
5245|MG|São João da Mata|3162302
5247|MG|São João da Ponte|3162401
5249|MG|São João del Rei|3162500
5251|MG|São João do Oriente|3162609
5253|MG|São João do Paraíso|3162708
5255|MG|São João Evangelista|3162807
5257|MG|São João Nepomuceno|3162906
5259|MG|São José da Safira|3163003
5261|MG|São José da Varginha|3163102
5263|MG|São José do Alegre|3163201
5265|MG|São José do Divino|3163300
5267|MG|São José do Goiabal|3163409
5269|MG|São José do Jacuri|3163508
5271|MG|São José do Mantimento|3163607
5273|MG|São Lourenço|3163706
5275|MG|São Miguel do Anta|3163805
5277|MG|São Pedro da União|3163904
5279|MG|São Pedro dos Ferros|3164001
5281|MG|São Pedro do Suaçuí|3164100
5283|MG|São Romão|3164209
5285|MG|São Roque de Minas|3164308
5287|MG|São Sebastião da Bela Vista|3164407
5289|MG|São Sebastião do Maranhão|3164506
5291|MG|São Sebastião do Oeste|3164605
5293|MG|São Sebastião do Paraíso|3164704
5295|MG|São Sebastião do Rio Preto|3164803
5297|MG|São Sebastião do Rio Verde|3164902
5299|MG|São Tiago|3165008
5301|MG|São Tomás de Aquino|3165107
5303|MG|São Tomé das Letras|3165206
5305|MG|São Vicente de Minas|3165305
5307|MG|Sapucaí-Mirim|3165404
5309|MG|Sardoá|3165503
5311|MG|Senador Cortes|3165602
5313|MG|Senador Firmino|3165701
5315|MG|Senador José Bento|3165800
5317|MG|Senador Modestino Gonçalves|3165909
5319|MG|Senhora de Oliveira|3166006
5321|MG|Senhora do Porto|3166105
5323|MG|Senhora dos Remédios|3166204
5325|MG|Sericita|3166303
5327|MG|Seritinga|3166402
5329|MG|Serra Azul de Minas|3166501
5331|MG|Serra da Saudade|3166600
5333|MG|Serra dos Aimorés|3166709
5335|MG|Serra do Salitre|3166808
5337|MG|Serrania|3166907
5339|MG|Serranos|3167004
5341|MG|Serro|3167103
5343|MG|Sete Lagoas|3167202
5345|MG|Silveirânia|3167301
5347|MG|Silvianópolis|3167400
5349|MG|Simão Pereira|3167509
5351|MG|Simonésia|3167608
5353|MG|Sobrália|3167707
5355|MG|Soledade de Minas|3167806
5357|MG|Tabuleiro|3167905
5359|MG|Taiobeiras|3168002
5361|MG|Tapira|3168101
5363|MG|Tapiraí|3168200
5365|MG|Taquaraçu de Minas|3168309
5367|MG|Tarumirim|3168408
5369|MG|Teixeiras|3168507
5371|MG|Teófilo Otoni|3168606
5373|MG|Timóteo|3168705
5375|MG|Tiradentes|3168804
5377|MG|Tiros|3168903
5379|MG|Tocantins|3169000
5381|MG|Toledo|3169109
5383|MG|Tombos|3169208
5385|MG|Três Corações|3169307
5387|MG|Três Pontas|3169406
5389|MG|Tumiritinga|3169505
5391|MG|Tupaciguara|3169604
5393|MG|Turmalina|3169703
5395|MG|Turvolândia|3169802
5397|MG|Ubá|3169901
5399|MG|Ubaí|3170008
5401|MG|Uberaba|3170107
5403|MG|Uberlândia|3170206
5405|MG|Umburatiba|3170305
5407|MG|Unaí|3170404
5409|MG|Urucânia|3170503
5411|MG|Vargem Bonita|3170602
5413|MG|Varginha|3170701
5415|MG|Várzea da Palma|3170800
5417|MG|Varzelândia|3170909
5419|MG|Vazante|3171006
5421|MG|Wenceslau Braz|3172202
5423|MG|Veríssimo|3171105
5425|MG|Vespasiano|3171204
5427|MG|Viçosa|3171303
5429|MG|Vieiras|3171402
5431|MG|Mathias Lobato|3171501
5433|MG|Virgem da Lapa|3171600
5435|MG|Virgínia|3171709
5437|MG|Virginópolis|3171808
5439|MG|Virgolândia|3171907
5441|MG|Visconde do Rio Branco|3172004
5443|MG|Volta Grande|3172103
5445|SP|Saltinho|3545159
5447|SP|São Lourenço da Serra|3549953
5449|PR|Doutor Ulysses|4128633
5451|PR|Itaperuçu|4111258
5453|PR|Pinhais|4119152
5455|PR|Tunas do Paraná|4127882
5457|PR|Nova Santa Bárbara|4117214
5459|PR|Mauá da Serra|4115754
5461|PR|Pitangueiras|4119657
5463|PR|Anahy|4101051
5465|PR|Diamante do Sul|4107124
5467|PR|Iguatu|4110052
5469|PR|Santa Lúcia|4123824
5471|PR|Boa Esperança do Iguaçu|4103024
5473|PR|Cruzeiro do Iguaçu|4106571
5475|PR|Flor da Serra do Sul|4107850
5477|PR|Nova Esperança do Sudoeste|4116950
5479|PR|Nova Laranjeiras|4117057
5481|PR|Rio Bonito do Iguaçu|4122156
5483|PR|Virmond|4128658
5485|PR|Iracema do Oeste|4110656
5487|PR|Maripá|4115358
5489|PR|São Pedro do Iguaçu|4125753
5491|PR|Cafezal do Sul|4103479
5493|PR|Saudade do Iguaçu|4126272
5495|PR|Pinhal de São Bento|4119251
5497|PR|Ventania|4128534
5499|PR|Candói|4104428
5501|PR|Laranjal|4113254
5503|PR|Mato Rico|4115739
5505|PR|Santa Maria do Oeste|4123857
5507|PR|Lidianópolis|4113429
5509|PR|Ângulo|4101150
5511|PR|Farol|4107553
5513|PR|Rancho Alegre D'Oeste|4121356
5515|PR|São Manoel do Paraná|4125555
5517|PR|Novo Itacolomi|4117297
5519|PR|Santa Mônica|4123956
5521|PR|Brasilândia do Sul|4103370
5523|PR|Alto Paraíso|4128625
5525|PR|Itaipulândia|4110953
5527|PR|Ramilândia|4121257
5529|PR|Entre Rios do Oeste|4107538
5531|PR|Mercedes|4115853
5533|PR|Pato Bragado|4118451
5535|PR|Quatro Pontes|4120853
5537|SC|Bombinhas|4202453
5539|SC|Morro Grande|4211256
5541|SC|Passo de Torres|4212254
5543|SC|Cocal do Sul|4204251
5545|SC|Capivari de Baixo|4203956
5547|SC|Sangão|4215455
5549|SC|Balneário Barra do Sul|4202057
5551|SC|São João do Itaperiú|4216354
5553|SC|Calmon|4203154
5555|SC|Santa Terezinha|4215679
5557|SC|Braço do Trombudo|4202859
5559|SC|Mirim Doce|4210852
5561|SC|Monte Carlo|4211058
5563|SC|Vargem|4219150
5565|SC|Vargem Bonita|4219176
5567|SC|Cerro Negro|4204178
5569|SC|Ponte Alta do Norte|4213351
5571|SC|Rio Rufino|4215059
5573|SC|São Cristóvão do Sul|4216057
5575|SC|Macieira|4210050
5577|SC|Águas Frias|4200556
5579|SC|Cordilheira Alta|4204350
5581|SC|Formosa do Sul|4205431
5583|SC|Guatambú|4206652
5585|SC|Irati|4207858
5587|SC|Jardinópolis|4208955
5589|SC|Nova Itaberaba|4211454
5591|SC|Novo Horizonte|4211652
5593|SC|Planalto Alegre|4213153
5595|SC|Sul Brasil|4217758
5597|SC|Arabutã|4201273
5599|SC|Arvoredo|4201653
5601|ES|Afonso Cláudio|3200102
5603|ES|Alegre|3200201
5605|ES|Alfredo Chaves|3200300
5607|ES|Anchieta|3200409
5609|ES|Apiacá|3200508
5611|ES|Aracruz|3200607
5613|ES|Atílio Vivácqua|3200706
5615|ES|Baixo Guandu|3200805
5617|ES|Barra de São Francisco|3200904
5619|ES|Boa Esperança|3201001
5621|ES|Bom Jesus do Norte|3201100
5623|ES|Cachoeiro de Itapemirim|3201209
5625|ES|Cariacica|3201308
5627|ES|Castelo|3201407
5629|ES|Colatina|3201506
5631|ES|Conceição da Barra|3201605
5633|ES|Conceição do Castelo|3201704
5635|ES|Divino de São Lourenço|3201803
5637|ES|Domingos Martins|3201902
5639|ES|Dores do Rio Preto|3202009
5641|ES|Ecoporanga|3202108
5643|ES|Fundão|3202207
5645|ES|Guaçuí|3202306
5647|ES|Guarapari|3202405
5649|ES|Ibiraçu|3202504
5651|ES|Iconha|3202603
5653|ES|Itaguaçu|3202702
5655|ES|Itapemirim|3202801
5657|ES|Itarana|3202900
5659|ES|Iúna|3203007
5661|ES|Jerônimo Monteiro|3203106
5663|ES|Linhares|3203205
5665|ES|Mantenópolis|3203304
5667|ES|Mimoso do Sul|3203403
5669|ES|Montanha|3203502
5671|ES|Mucurici|3203601
5673|ES|Muniz Freire|3203700
5675|ES|Muqui|3203809
5677|ES|Nova Venécia|3203908
5679|ES|Pancas|3204005
5681|ES|Pinheiros|3204104
5683|ES|Piúma|3204203
5685|ES|Presidente Kennedy|3204302
5687|ES|Rio Novo do Sul|3204401
5689|ES|Santa Leopoldina|3204500
5691|ES|Santa Teresa|3204609
5693|ES|São Gabriel da Palha|3204708
5695|ES|São José do Calçado|3204807
5697|ES|São Mateus|3204906
5699|ES|Serra|3205002
5701|ES|Viana|3205101
5703|ES|Vila Velha|3205200
5705|ES|Vitória|3205309
5707|ES|Marilândia|3203353
5709|ES|Ibatiba|3202454
5711|ES|Rio Bananal|3204351
5713|ES|Jaguaré|3203056
5715|ES|Pedro Canário|3204054
5717|ES|Água Doce do Norte|3200169
5719|ES|Alto Rio Novo|3200359
5721|ES|João Neiva|3203130
5723|ES|Laranja da Terra|3203163
5725|ES|Santa Maria de Jetibá|3204559
5727|ES|Vargem Alta|3205036
5729|ES|Venda Nova do Imigrante|3205069
5731|MG|Itaú de Minas|3133758
5733|ES|Águia Branca|3200136
5735|SC|Coronel Martins|4204459
5737|SC|Ipuaçu|4207684
5739|SC|Lajeado Grande|4209458
5741|SC|Ouro Verde|4211850
5743|SC|Passos Maia|4212270
5745|SC|Belmonte|4202156
5747|SC|Paraíso|4212239
5749|SC|Riqueza|4215075
5751|SC|Santa Helena|4215554
5753|SC|São João do Oeste|4216255
5755|SC|São Miguel da Boa Vista|4217154
5757|RS|Nova Santa Rita|4313375
5759|RS|Mariana Pimentel|4311981
5761|RS|Sertão Santana|4320552
5763|RS|Gramado Xavier|4309159
5765|RS|Passo do Sobrado|4314076
5767|RS|Sinimbu|4320677
5769|RS|Vale do Sol|4322533
5771|RS|Barão do Triunfo|4301750
5773|RS|Minas do Leão|4312252
5775|RS|Morrinhos do Sul|4312443
5777|RS|Três Forquilhas|4321832
5779|RS|Arambaré|4300851
5781|RS|Sentinela do Sul|4320354
5783|RS|Maquiné|4311775
5785|RS|Xangri-lá|4323804
5787|RS|Pinhal Grande|4314472
5789|RS|Quevedos|4315321
5791|RS|São João do Polêsine|4318432
5793|RS|São Martinho da Serra|4319125
5795|RS|Vila Nova do Sul|4323457
5797|RS|Coxilha|4305975
5799|RS|Gentil|4308854
5801|RJ|Angra dos Reis|3300100
5803|RJ|Araruama|3300209
5805|RJ|Barra do Piraí|3300308
5807|RJ|Barra Mansa|3300407
5809|RJ|Bom Jardim|3300506
5811|RJ|Bom Jesus do Itabapoana|3300605
5813|RJ|Cabo Frio|3300704
5815|RJ|Cachoeiras de Macacu|3300803
5817|RJ|Cambuci|3300902
5819|RJ|Campos dos Goytacazes|3301009
5821|RJ|Cantagalo|3301108
5823|RJ|Carmo|3301207
5825|RJ|Casimiro de Abreu|3301306
5827|RJ|Conceição de Macabu|3301405
5829|RJ|Cordeiro|3301504
5831|RJ|Duas Barras|3301603
5833|RJ|Duque de Caxias|3301702
5835|RJ|Engenheiro Paulo de Frontin|3301801
5837|RJ|Itaboraí|3301900
5839|RJ|Itaguaí|3302007
5841|RJ|Itaocara|3302106
5843|RJ|Itaperuna|3302205
5845|RJ|Laje do Muriaé|3302304
5847|RJ|Macaé|3302403
5849|RJ|Magé|3302502
5851|RJ|Mangaratiba|3302601
5853|RJ|Maricá|3302700
5855|RJ|Mendes|3302809
5857|RJ|Miguel Pereira|3302908
5859|RJ|Miracema|3303005
5861|RJ|Natividade|3303104
5863|RJ|Nilópolis|3303203
5865|RJ|Niterói|3303302
5867|RJ|Nova Friburgo|3303401
5869|RJ|Nova Iguaçu|3303500
5871|RJ|Paracambi|3303609
5873|RJ|Paraíba do Sul|3303708
5875|RJ|Paraty|3303807
5877|RJ|Petrópolis|3303906
5879|RJ|Piraí|3304003
5881|RJ|Porciúncula|3304102
5883|RJ|Resende|3304201
5885|RJ|Rio Bonito|3304300
5887|RJ|Rio Claro|3304409
5889|RJ|Rio das Flores|3304508
5891|RJ|Santa Maria Madalena|3304607
5893|RJ|Santo Antônio de Pádua|3304706
5895|RJ|São Fidélis|3304805
5897|RJ|São Gonçalo|3304904
5899|RJ|São João da Barra|3305000
5901|RJ|São João de Meriti|3305109
5903|RJ|São Pedro da Aldeia|3305208
5905|RJ|São Sebastião do Alto|3305307
5907|RJ|Sapucaia|3305406
5909|RJ|Saquarema|3305505
5911|RJ|Silva Jardim|3305604
5913|RJ|Sumidouro|3305703
5915|RJ|Teresópolis|3305802
5917|RJ|Trajano de Moraes|3305901
5919|RJ|Três Rios|3306008
5921|RJ|Valença|3306107
5923|RJ|Vassouras|3306206
5925|RJ|Volta Redonda|3306305
5927|RJ|Arraial do Cabo|3300258
5929|RJ|Italva|3302056
5931|RS|Mato Castelhano|4312138
5933|RS|Mormaço|4312427
5935|RS|Muliterno|4312625
5937|RS|Nicolau Vergueiro|4312674
5939|RS|Pontão|4314779
5941|RS|Santo Antônio do Palma|4317558
5943|RS|Barra Funda|4301958
5945|RS|Coqueiros do Sul|4305850
5947|RS|Engenho Velho|4306924
5949|RS|Gramado dos Loureiros|4309126
5951|RS|Lagoa dos Três Cantos|4311270
5953|RS|Nova Boa Vista|4312955
5955|RS|Rio dos Índios|4315552
5957|RS|Santo Antônio do Planalto|4317756
5959|RS|Barra do Rio Azul|4301925
5961|RS|Carlos Gomes|4304853
5963|RS|Centenário|4305116
5965|RS|Charrua|4305371
5967|RS|Ponte Preta|4314787
5969|RS|Ametista do Sul|4300646
5971|RS|Dois Irmãos das Missões|4306429
5973|RS|Novo Tiradentes|4313441
5975|RS|Pinheirinho do Vale|4314498
5977|RS|Santo Expedito do Sul|4317954
5979|RS|Tupanci do Sul|4322186
5981|RS|Boa Vista das Missões|4302154
5983|RS|Lajeado do Bugre|4311429
5985|RS|Novo Barreiro|4313490
5987|RS|Sagrada Família|4316428
5989|RS|São José das Missões|4318457
5991|RS|Nova Pádua|4313086
5993|RS|Monte Belo do Sul|4312385
5995|RS|Santa Tereza|4317251
5997|RS|São Valentim do Sul|4319711
5999|RS|União da Serra|4322350
6001|RJ|Rio de Janeiro|3304557
6003|RJ|Itatiaia|3302254
6005|RJ|Paty do Alferes|3303856
6007|RJ|Quissamã|3304151
6009|RJ|São José do Vale do Rio Preto|3305158
6011|ES|Ibitirama|3202553
6013|RS|Campestre da Serra|4303673
6015|RS|São José dos Ausentes|4318622
6017|RS|Lindolfo Collor|4311627
6019|RS|Morro Reuter|4312476
6021|RS|Picada Café|4314423
6023|RS|Presidente Lucena|4315149
6025|RS|Capitão|4304697
6027|RS|Itapuca|4310579
6029|RS|Colinas|4305587
6031|RS|Mato Leitão|4312153
6033|RS|Santa Clara do Sul|4316758
6035|RS|Sério|4320453
6037|RS|Travesseiro|4321626
6039|RS|Maratá|4311791
6041|RS|Pareci Novo|4314035
6043|RS|São Pedro da Serra|4319356
6045|RS|Alto Feliz|4300570
6047|RS|Linha Nova|4311643
6049|RS|Vale Real|4322541
6051|RS|Inhacorá|4310413
6053|RS|Vitória das Missões|4323754
6055|RS|Coronel Barros|4305871
6057|RS|Novo Machado|4313425
6059|RS|São José do Inhacorá|4318499
6061|RS|Salvador das Missões|4316477
6063|RS|São Pedro do Butiá|4319372
6065|RS|Porto Mauá|4315057
6067|RS|Porto Vera Cruz|4315073
6069|RS|Barra do Guarita|4301859
6071|RS|Bom Progresso|4302378
6073|RS|Derrubadas|4306320
6075|RS|São Valério do Sul|4319737
6077|RS|Tiradentes do Sul|4321477
6079|RS|Manoel Viana|4311759
6081|RS|Garruchos|4308656
6083|RS|Candiota|4304358
6085|RS|Hulha Negra|4309654
6087|MT|São José do Povo|5107297
6101|SP|Adamantina|3500105
6103|SP|Adolfo|3500204
6105|SP|Aguaí|3500303
6107|SP|Águas da Prata|3500402
6109|SP|Águas de Lindóia|3500501
6111|SP|Águas de São Pedro|3500600
6113|SP|Agudos|3500709
6115|SP|Alfredo Marcondes|3500808
6117|SP|Altair|3500907
6119|SP|Altinópolis|3501004
6121|SP|Alto Alegre|3501103
6123|SP|Álvares Florence|3501202
6125|SP|Álvares Machado|3501301
6127|SP|Álvaro de Carvalho|3501400
6129|SP|Alvinlândia|3501509
6131|SP|Americana|3501608
6133|SP|Américo Brasiliense|3501707
6135|SP|Américo de Campos|3501806
6137|SP|Amparo|3501905
6139|SP|Analândia|3502002
6141|SP|Andradina|3502101
6143|SP|Angatuba|3502200
6145|SP|Anhembi|3502309
6147|SP|Anhumas|3502408
6149|SP|Aparecida|3502507
6151|SP|Aparecida d'Oeste|3502606
6153|SP|Apiaí|3502705
6155|SP|Araçatuba|3502804
6157|SP|Araçoiaba da Serra|3502903
6159|SP|Aramina|3503000
6161|SP|Arandu|3503109
6163|SP|Araraquara|3503208
6165|SP|Araras|3503307
6167|SP|Arealva|3503406
6169|SP|Areias|3503505
6171|SP|Areiópolis|3503604
6173|SP|Ariranha|3503703
6175|SP|Artur Nogueira|3503802
6177|SP|Arujá|3503901
6179|SP|Assis|3504008
6181|SP|Atibaia|3504107
6183|SP|Auriflama|3504206
6185|SP|Avaí|3504305
6187|SP|Avanhandava|3504404
6189|SP|Avaré|3504503
6191|SP|Bady Bassitt|3504602
6193|SP|Balbinos|3504701
6195|SP|Bálsamo|3504800
6197|SP|Bananal|3504909
6199|SP|Barbosa|3505104
6201|SP|Barão de Antonina|3505005
6203|SP|Bariri|3505203
6205|SP|Barra Bonita|3505302
6207|SP|Barra do Turvo|3505401
6209|SP|Barretos|3505500
6211|SP|Barrinha|3505609
6213|SP|Barueri|3505708
6215|SP|Bastos|3505807
6217|SP|Batatais|3505906
6219|SP|Bauru|3506003
6221|SP|Bebedouro|3506102
6223|SP|Bento de Abreu|3506201
6225|SP|Bernardino de Campos|3506300
6227|SP|Bilac|3506409
6229|SP|Birigui|3506508
6231|SP|Biritiba Mirim|3506607
6233|SP|Boa Esperança do Sul|3506706
6235|SP|Bocaina|3506805
6237|SP|Bofete|3506904
6239|SP|Boituva|3507001
6241|SP|Bom Jesus dos Perdões|3507100
6243|SP|Borá|3507209
6245|SP|Boracéia|3507308
6247|SP|Borborema|3507407
6249|SP|Botucatu|3507506
6251|SP|Bragança Paulista|3507605
6255|SP|Braúna|3507704
6257|SP|Brodowski|3507803
6259|SP|Brotas|3507902
6261|SP|Buri|3508009
6263|SP|Buritama|3508108
6265|SP|Buritizal|3508207
6267|SP|Cabrália Paulista|3508306
6269|SP|Cabreúva|3508405
6271|SP|Caçapava|3508504
6273|SP|Cachoeira Paulista|3508603
6275|SP|Caconde|3508702
6277|SP|Cafelândia|3508801
6279|SP|Caiabu|3508900
6281|SP|Caieiras|3509007
6283|SP|Caiuá|3509106
6285|SP|Cajamar|3509205
6287|SP|Cajobi|3509304
6289|SP|Cajuru|3509403
6291|SP|Campinas|3509502
6293|SP|Campo Limpo Paulista|3509601
6295|SP|Campos do Jordão|3509700
6297|SP|Campos Novos Paulista|3509809
6299|SP|Cananéia|3509908
6301|SP|Cândido Mota|3510005
6303|SP|Cândido Rodrigues|3510104
6305|SP|Capão Bonito|3510203
6307|SP|Capela do Alto|3510302
6309|SP|Capivari|3510401
6311|SP|Caraguatatuba|3510500
6313|SP|Carapicuíba|3510609
6315|SP|Cardoso|3510708
6317|SP|Casa Branca|3510807
6319|SP|Cássia dos Coqueiros|3510906
6321|SP|Castilho|3511003
6323|SP|Catanduva|3511102
6325|SP|Catiguá|3511201
6327|SP|Cedral|3511300
6329|SP|Cerqueira César|3511409
6331|SP|Cerquilho|3511508
6333|SP|Cesário Lange|3511607
6335|SP|Charqueada|3511706
6337|SP|Chavantes|3557204
6339|SP|Clementina|3511904
6341|SP|Colina|3512001
6343|SP|Colômbia|3512100
6345|SP|Conchal|3512209
6347|SP|Conchas|3512308
6349|SP|Cordeirópolis|3512407
6351|SP|Coroados|3512506
6353|SP|Coronel Macedo|3512605
6355|SP|Corumbataí|3512704
6357|SP|Cosmópolis|3512803
6359|SP|Cosmorama|3512902
6361|SP|Cotia|3513009
6363|SP|Cravinhos|3513108
6365|SP|Cristais Paulista|3513207
6367|SP|Cruzália|3513306
6369|SP|Cruzeiro|3513405
6371|SP|Cubatão|3513504
6373|SP|Cunha|3513603
6375|SP|Descalvado|3513702
6377|SP|Diadema|3513801
6379|SP|Divinolândia|3513900
6381|SP|Dobrada|3514007
6383|SP|Dois Córregos|3514106
6385|SP|Dolcinópolis|3514205
6387|SP|Dourado|3514304
6389|SP|Dracena|3514403
6391|SP|Duartina|3514502
6393|SP|Dumont|3514601
6395|SP|Echaporã|3514700
6397|SP|Eldorado|3514809
6399|SP|Elias Fausto|3514908
6401|SP|Embu das Artes|3515004
6403|SP|Embu-Guaçu|3515103
6405|SP|Estrela d'Oeste|3515202
6407|SP|Estrela do Norte|3515301
6409|SP|Fartura|3515400
6411|SP|Fernandópolis|3515509
6413|SP|Fernando Prestes|3515608
6415|SP|Ferraz de Vasconcelos|3515707
6417|SP|Flora Rica|3515806
6419|SP|Floreal|3515905
6421|SP|Flórida Paulista|3516002
6423|SP|Florínea|3516101
6425|SP|Franca|3516200
6427|SP|Francisco Morato|3516309
6429|SP|Franco da Rocha|3516408
6431|SP|Gabriel Monteiro|3516507
6433|SP|Gália|3516606
6435|SP|Garça|3516705
6437|SP|Gastão Vidigal|3516804
6439|SP|General Salgado|3516903
6441|SP|Getulina|3517000
6443|SP|Glicério|3517109
6445|SP|Guaiçara|3517208
6447|SP|Guaimbê|3517307
6449|SP|Guaíra|3517406
6451|SP|Guapiaçu|3517505
6453|SP|Guapiara|3517604
6455|SP|Guará|3517703
6457|SP|Guaraçaí|3517802
6459|SP|Guaraci|3517901
6461|SP|Guarani d'Oeste|3518008
6463|SP|Guarantã|3518107
6465|SP|Guararapes|3518206
6467|SP|Guararema|3518305
6469|SP|Guaratinguetá|3518404
6471|SP|Guareí|3518503
6473|SP|Guariba|3518602
6475|SP|Guarujá|3518701
6477|SP|Guarulhos|3518800
6479|SP|Guzolândia|3518909
6481|SP|Herculândia|3519006
6483|SP|Iacanga|3519105
6485|SP|Iacri|3519204
6487|SP|Ibaté|3519303
6489|SP|Ibirá|3519402
6491|SP|Ibirarema|3519501
6493|SP|Ibitinga|3519600
6495|SP|Ibiúna|3519709
6497|SP|Icém|3519808
6499|SP|Iepê|3519907
6501|SP|Igaraçu do Tietê|3520004
6503|SP|Igarapava|3520103
6505|SP|Igaratá|3520202
6507|SP|Iguape|3520301
6509|SP|Ilhabela|3520400
6511|SP|Indaiatuba|3520509
6513|SP|Indiana|3520608
6515|SP|Indiaporã|3520707
6517|SP|Inúbia Paulista|3520806
6519|SP|Ipaussu|3520905
6521|SP|Iperó|3521002
6523|SP|Ipeúna|3521101
6525|SP|Iporanga|3521200
6527|SP|Ipuã|3521309
6529|SP|Iracemápolis|3521408
6531|SP|Irapuã|3521507
6533|SP|Irapuru|3521606
6535|SP|Itaberá|3521705
6537|SP|Itaí|3521804
6539|SP|Itajobi|3521903
6541|SP|Itaju|3522000
6543|SP|Itanhaém|3522109
6545|SP|Itapecerica da Serra|3522208
6547|SP|Itapetininga|3522307
6549|SP|Itapeva|3522406
6551|SP|Itapevi|3522505
6553|SP|Itapira|3522604
6555|SP|Itápolis|3522703
6557|SP|Itaporanga|3522802
6559|SP|Itapuí|3522901
6561|SP|Itapura|3523008
6563|SP|Itaquaquecetuba|3523107
6565|SP|Itararé|3523206
6567|SP|Itariri|3523305
6569|SP|Itatiba|3523404
6571|SP|Itatinga|3523503
6573|SP|Itirapina|3523602
6575|SP|Itirapuã|3523701
6577|SP|Itobi|3523800
6579|SP|Itu|3523909
6581|SP|Itupeva|3524006
6583|SP|Ituverava|3524105
6585|SP|Jaborandi|3524204
6587|SP|Jaboticabal|3524303
6589|SP|Jacareí|3524402
6591|SP|Jaci|3524501
6593|SP|Jacupiranga|3524600
6595|SP|Jaguariúna|3524709
6597|SP|Jales|3524808
6599|SP|Jambeiro|3524907
6601|SP|Jandira|3525003
6603|SP|Jardinópolis|3525102
6605|SP|Jarinu|3525201
6607|SP|Jaú|3525300
6609|SP|Jeriquara|3525409
6611|SP|Joanópolis|3525508
6613|SP|João Ramalho|3525607
6615|SP|José Bonifácio|3525706
6617|SP|Júlio Mesquita|3525805
6619|SP|Jundiaí|3525904
6621|SP|Junqueirópolis|3526001
6623|SP|Juquiá|3526100
6625|SP|Juquitiba|3526209
6627|SP|Lagoinha|3526308
6629|SP|Laranjal Paulista|3526407
6631|SP|Lavínia|3526506
6633|SP|Lavrinhas|3526605
6635|SP|Leme|3526704
6637|SP|Lençóis Paulista|3526803
6639|SP|Limeira|3526902
6641|SP|Lindóia|3527009
6643|SP|Lins|3527108
6645|SP|Lorena|3527207
6647|SP|Louveira|3527306
6649|SP|Lucélia|3527405
6651|SP|Lucianópolis|3527504
6653|SP|Luís Antônio|3527603
6655|SP|Luiziânia|3527702
6657|SP|Lupércio|3527801
6659|SP|Lutécia|3527900
6661|SP|Macatuba|3528007
6663|SP|Macaubal|3528106
6665|SP|Macedônia|3528205
6667|SP|Magda|3528304
6669|SP|Mairinque|3528403
6671|SP|Mairiporã|3528502
6673|SP|Manduri|3528601
6675|SP|Marabá Paulista|3528700
6677|SP|Maracaí|3528809
6679|SP|Mariápolis|3528908
6681|SP|Marília|3529005
6683|SP|Marinópolis|3529104
6685|SP|Martinópolis|3529203
6687|SP|Matão|3529302
6689|SP|Mauá|3529401
6691|SP|Mendonça|3529500
6693|SP|Meridiano|3529609
6695|SP|Miguelópolis|3529708
6697|SP|Mineiros do Tietê|3529807
6699|SP|Miracatu|3529906
6701|SP|Mira Estrela|3530003
6703|SP|Mirandópolis|3530102
6705|SP|Mirante do Paranapanema|3530201
6707|SP|Mirassol|3530300
6709|SP|Mirassolândia|3530409
6711|SP|Mococa|3530508
6713|SP|Mogi das Cruzes|3530607
6715|SP|Mogi Guaçu|3530706
6717|SP|Mogi Mirim|3530805
6719|SP|Mombuca|3530904
6721|SP|Monções|3531001
6723|SP|Mongaguá|3531100
6725|SP|Monte Alegre do Sul|3531209
6727|SP|Monte Alto|3531308
6729|SP|Monte Aprazível|3531407
6731|SP|Monte Azul Paulista|3531506
6733|SP|Monte Castelo|3531605
6735|SP|Monteiro Lobato|3531704
6737|SP|Monte Mor|3531803
6739|SP|Morro Agudo|3531902
6741|SP|Morungaba|3532009
6743|SP|Murutinga do Sul|3532108
6745|SP|Narandiba|3532207
6747|SP|Natividade da Serra|3532306
6749|SP|Nazaré Paulista|3532405
6751|SP|Neves Paulista|3532504
6753|SP|Nhandeara|3532603
6755|SP|Nipoã|3532702
6757|SP|Nova Aliança|3532801
6759|SP|Nova Europa|3532900
6761|SP|Nova Granada|3533007
6763|SP|Nova Guataporanga|3533106
6765|SP|Nova Independência|3533205
6767|SP|Nova Luzitânia|3533304
6769|SP|Nova Odessa|3533403
6771|SP|Novo Horizonte|3533502
6773|SP|Nuporanga|3533601
6775|SP|Ocauçu|3533700
6777|SP|Óleo|3533809
6779|SP|Olímpia|3533908
6781|SP|Onda Verde|3534005
6783|SP|Oriente|3534104
6785|SP|Orindiúva|3534203
6787|SP|Orlândia|3534302
6789|SP|Osasco|3534401
6791|SP|Oscar Bressane|3534500
6793|SP|Osvaldo Cruz|3534609
6795|SP|Ourinhos|3534708
6797|SP|Ouro Verde|3534807
6799|SP|Pacaembu|3534906
6801|SP|Palestina|3535002
6803|SP|Palmares Paulista|3535101
6805|SP|Palmeira d'Oeste|3535200
6807|SP|Palmital|3535309
6809|SP|Panorama|3535408
6811|SP|Paraguaçu Paulista|3535507
6813|SP|Paraibuna|3535606
6815|SP|Paraíso|3535705
6817|SP|Paranapanema|3535804
6819|SP|Paranapuã|3535903
6821|SP|Parapuã|3536000
6823|SP|Pardinho|3536109
6825|SP|Pariquera-Açu|3536208
6827|SP|Patrocínio Paulista|3536307
6829|SP|Paulicéia|3536406
6831|SP|Paulínia|3536505
6833|SP|Paulo de Faria|3536604
6835|SP|Pederneiras|3536703
6837|SP|Pedra Bela|3536802
6839|SP|Pedranópolis|3536901
6841|SP|Pedregulho|3537008
6843|SP|Pedreira|3537107
6845|SP|Pedro de Toledo|3537206
6847|SP|Penápolis|3537305
6849|SP|Pereira Barreto|3537404
6851|SP|Pereiras|3537503
6853|SP|Peruíbe|3537602
6855|SP|Piacatu|3537701
6857|SP|Piedade|3537800
6859|SP|Pilar do Sul|3537909
6861|SP|Pindamonhangaba|3538006
6863|SP|Pindorama|3538105
6865|SP|Espírito Santo do Pinhal|3515186
6867|SP|Pinhalzinho|3538204
6869|SP|Piquerobi|3538303
6871|SP|Piquete|3538501
6873|SP|Piracaia|3538600
6875|SP|Piracicaba|3538709
6877|SP|Piraju|3538808
6879|SP|Pirajuí|3538907
6881|SP|Pirangi|3539004
6883|SP|Pirapora do Bom Jesus|3539103
6885|SP|Pirapozinho|3539202
6887|SP|Pirassununga|3539301
6889|SP|Piratininga|3539400
6891|SP|Pitangueiras|3539509
6893|SP|Planalto|3539608
6895|SP|Platina|3539707
6897|SP|Poá|3539806
6899|SP|Poloni|3539905
6901|SP|Pompéia|3540002
6903|SP|Pongaí|3540101
6905|SP|Pontal|3540200
6907|SP|Pontes Gestal|3540309
6909|SP|Populina|3540408
6911|SP|Porangaba|3540507
6913|SP|Porto Feliz|3540606
6915|SP|Porto Ferreira|3540705
6917|SP|Potirendaba|3540804
6919|SP|Pradópolis|3540903
6921|SP|Praia Grande|3541000
6923|SP|Presidente Alves|3541109
6925|SP|Presidente Bernardes|3541208
6927|SP|Presidente Epitácio|3541307
6929|SP|Presidente Prudente|3541406
6931|SP|Presidente Venceslau|3541505
6933|SP|Promissão|3541604
6935|SP|Quatá|3541703
6937|SP|Queiroz|3541802
6939|SP|Queluz|3541901
6941|SP|Quintana|3542008
6943|SP|Rafard|3542107
6945|SP|Rancharia|3542206
6947|SP|Redenção da Serra|3542305
6949|SP|Regente Feijó|3542404
6951|SP|Reginópolis|3542503
6953|SP|Registro|3542602
6955|SP|Restinga|3542701
6957|SP|Ribeira|3542800
6959|SP|Ribeirão Bonito|3542909
6961|SP|Ribeirão Branco|3543006
6963|SP|Ribeirão Corrente|3543105
6965|SP|Ribeirão do Sul|3543204
6967|SP|Ribeirão Pires|3543303
6969|SP|Ribeirão Preto|3543402
6971|SP|Riversul|3543501
6973|SP|Rifaina|3543600
6975|SP|Rincão|3543709
6977|SP|Rinópolis|3543808
6979|SP|Rio Claro|3543907
6981|SP|Rio das Pedras|3544004
6983|SP|Rio Grande da Serra|3544103
6985|SP|Riolândia|3544202
6987|SP|Roseira|3544301
6989|SP|Rubiácea|3544400
6991|SP|Rubinéia|3544509
6993|SP|Sabino|3544608
6995|SP|Sagres|3544707
6997|SP|Sales|3544806
6999|SP|Sales Oliveira|3544905
7001|SP|Salesópolis|3545001
7003|SP|Salmourão|3545100
7005|SP|Salto|3545209
7007|SP|Salto de Pirapora|3545308
7009|SP|Salto Grande|3545407
7011|SP|Sandovalina|3545506
7013|SP|Santa Adélia|3545605
7015|SP|Santa Albertina|3545704
7017|SP|Santa Bárbara d'Oeste|3545803
7019|SP|Águas de Santa Bárbara|3500550
7021|SP|Santa Branca|3546009
7023|SP|Santa Clara d'Oeste|3546108
7025|SP|Santa Cruz da Conceição|3546207
7027|SP|Santa Cruz das Palmeiras|3546306
7029|SP|Santa Cruz do Rio Pardo|3546405
7031|SP|Santa Ernestina|3546504
7033|SP|Santa Fé do Sul|3546603
7035|SP|Santa Gertrudes|3546702
7037|SP|Santa Isabel|3546801
7039|SP|Santa Lúcia|3546900
7041|SP|Santa Maria da Serra|3547007
7043|SP|Santa Mercedes|3547106
7045|SP|Santana da Ponte Pensa|3547205
7047|SP|Santana de Parnaíba|3547304
7049|SP|Santa Rita d'Oeste|3547403
7051|SP|Santa Rita do Passa Quatro|3547502
7053|SP|Santa Rosa de Viterbo|3547601
7055|SP|Santo Anastácio|3547700
7057|SP|Santo André|3547809
7059|SP|Santo Antônio da Alegria|3547908
7061|SP|Santo Antônio de Posse|3548005
7063|SP|Santo Antônio do Jardim|3548104
7065|SP|Santo Antônio do Pinhal|3548203
7067|SP|Santo Expedito|3548302
7069|SP|Santópolis do Aguapeí|3548401
7071|SP|Santos|3548500
7073|SP|São Bento do Sapucaí|3548609
7075|SP|São Bernardo do Campo|3548708
7077|SP|São Caetano do Sul|3548807
7079|SP|São Carlos|3548906
7081|SP|São Francisco|3549003
7083|SP|São João da Boa Vista|3549102
7085|SP|São João das Duas Pontes|3549201
7087|SP|São João do Pau d'Alho|3549300
7089|SP|São Joaquim da Barra|3549409
7091|SP|São José da Bela Vista|3549508
7093|SP|São José do Barreiro|3549607
7095|SP|São José do Rio Pardo|3549706
7097|SP|São José do Rio Preto|3549805
7099|SP|São José dos Campos|3549904
7101|SP|São Luiz do Paraitinga|3550001
7103|SP|São Manuel|3550100
7105|SP|São Miguel Arcanjo|3550209
7107|SP|São Paulo|3550308
7109|SP|São Pedro|3550407
7111|SP|São Pedro do Turvo|3550506
7113|SP|São Roque|3550605
7115|SP|São Sebastião|3550704
7117|SP|São Sebastião da Grama|3550803
7119|SP|São Simão|3550902
7121|SP|São Vicente|3551009
7123|SP|Sarapuí|3551108
7125|SP|Sarutaiá|3551207
7127|SP|Sebastianópolis do Sul|3551306
7129|SP|Serra Azul|3551405
7131|SP|Serrana|3551504
7133|SP|Serra Negra|3551603
7135|SP|Sertãozinho|3551702
7137|SP|Sete Barras|3551801
7139|SP|Severínia|3551900
7141|SP|Silveiras|3552007
7143|SP|Socorro|3552106
7145|SP|Sorocaba|3552205
7147|SP|Sud Mennucci|3552304
7149|SP|Sumaré|3552403
7151|SP|Suzano|3552502
7153|SP|Tabapuã|3552601
7155|SP|Tabatinga|3552700
7157|SP|Taboão da Serra|3552809
7159|SP|Taciba|3552908
7161|SP|Taguaí|3553005
7163|SP|Taiaçu|3553104
7165|SP|Taiúva|3553203
7167|SP|Tambaú|3553302
7169|SP|Tanabi|3553401
7171|SP|Tapiraí|3553500
7173|SP|Tapiratiba|3553609
7175|SP|Taquaritinga|3553708
7177|SP|Taquarituba|3553807
7179|SP|Tarabai|3553906
7181|SP|Tatuí|3554003
7183|SP|Taubaté|3554102
7185|SP|Tejupá|3554201
7187|SP|Teodoro Sampaio|3554300
7189|SP|Terra Roxa|3554409
7191|SP|Tietê|3554508
7193|SP|Timburi|3554607
7195|SP|Torrinha|3554706
7197|SP|Tremembé|3554805
7199|SP|Três Fronteiras|3554904
7201|SP|Tupã|3555000
7203|SP|Tupi Paulista|3555109
7205|SP|Turiúba|3555208
7207|SP|Turmalina|3555307
7209|SP|Ubatuba|3555406
7211|SP|Ubirajara|3555505
7213|SP|Uchoa|3555604
7215|SP|União Paulista|3555703
7217|SP|Urânia|3555802
7219|SP|Uru|3555901
7221|SP|Urupês|3556008
7223|SP|Valentim Gentil|3556107
7225|SP|Valinhos|3556206
7227|SP|Valparaíso|3556305
7231|SP|Vargem Grande do Sul|3556404
7233|SP|Várzea Paulista|3556503
7235|SP|Vera Cruz|3556602
7237|SP|Vinhedo|3556701
7239|SP|Viradouro|3556800
7241|SP|Vista Alegre do Alto|3556909
7243|SP|Votorantim|3557006
7245|SP|Votuporanga|3557105
7247|SP|Borebi|3507456
7249|SP|Dirce Reis|3513850
7251|SP|Embaúba|3514957
7253|SP|Espírito Santo do Turvo|3515194
7255|SP|Euclides da Cunha Paulista|3515350
7257|SP|Guatapará|3518859
7259|SP|Iaras|3519253
7263|SP|Motuca|3532058
7265|SP|Rosana|3544251
7267|SP|Tarumã|3553955
7273|SP|Vargem Grande Paulista|3556453
7293|RS|São Vendelino|4319752
7295|RS|Imigrante|4310363
7297|RS|Imbé|4310330
7299|RS|Ibirapuitã|4309951
7301|RS|Estação|4307559
7303|RS|Vista Gaúcha|4323705
7305|RS|Vista Alegre do Prata|4323606
7307|RS|Vista Alegre|4323507
7309|RS|Vila Maria|4323408
7311|RS|Vila Flores|4323309
7313|RS|Taquaruçu do Sul|4321329
7315|RS|Silveira Martins|4320651
7317|RS|Segredo|4320263
7319|RS|Vanini|4322558
7321|RS|Tupandi|4322251
7323|RS|Tunas|4322152
7325|RS|Trindade do Sul|4321956
7327|RS|Três Palmeiras|4321857
7329|RS|Três Cachoeiras|4321667
7331|RS|Três Arroios|4321634
7333|RS|Terra de Areia|4321436
7335|RS|Sede Nova|4320230
7337|RS|Santa Maria do Herval|4316956
7339|RS|Saldanha Marinho|4316436
7341|RS|São Miguel das Missões|4319158
7343|RS|São José do Hortêncio|4318481
7345|RS|São José do Herval|4318465
7347|RS|São Jorge|4318440
7349|RS|São João da Urtiga|4318424
7351|RS|São Domingos do Sul|4318051
7353|RS|Riozinho|4315750
7355|RS|Relvado|4315453
7357|RS|Quinze de Novembro|4315354
7359|RS|Protásio Alves|4315172
7361|RS|Progresso|4315156
7363|RS|Pouso Novo|4315131
7365|RS|Poço das Antas|4314753
7367|RS|Pirapó|4314555
7369|RS|Pinhal|4314456
7371|RS|Paverama|4314159
7373|RS|Paraíso do Sul|4314027
7375|RS|Pantano Grande|4313953
7377|RS|Nova Roma do Sul|4313359
7379|RS|Nova Hartz|4313060
7381|RS|Nova Esperança do Sul|4313037
7383|RS|Nova Alvorada|4312757
7385|RS|Morro Redondo|4312450
7387|RS|Montauri|4312351
7389|RS|Lagoão|4311254
7391|RS|Jaquirana|4311122
7393|RS|Jaboticaba|4310850
7395|RS|Ivorá|4310751
7397|RS|Itacurubi|4310553
7399|RS|Ipiranga do Sul|4310462
7401|PR|Abatiá|4100103
7403|PR|Adrianópolis|4100202
7405|PR|Agudos do Sul|4100301
7407|PR|Almirante Tamandaré|4100400
7409|PR|Alto Paraná|4100608
7411|PR|Alto Piquiri|4100707
7413|PR|Alvorada do Sul|4100806
7415|PR|Amaporã|4100905
7417|PR|Ampére|4101002
7419|PR|Andirá|4101101
7421|PR|Antonina|4101200
7423|PR|Antônio Olinto|4101309
7425|PR|Apucarana|4101408
7427|PR|Arapongas|4101507
7429|PR|Arapoti|4101606
7431|PR|Araruna|4101705
7433|PR|Marilândia do Sul|4114906
7435|PR|Araucária|4101804
7437|PR|Assaí|4101903
7439|PR|Astorga|4102109
7441|PR|Atalaia|4102208
7443|PR|Balsa Nova|4102307
7445|PR|Bandeirantes|4102406
7447|PR|Barbosa Ferraz|4102505
7449|PR|Barracão|4102604
7451|PR|Barra do Jacaré|4102703
7453|PR|Bela Vista do Paraíso|4102802
7455|PR|Bituruna|4102901
7457|PR|Boa Esperança|4103008
7459|PR|Bocaiúva do Sul|4103107
7461|PR|Bom Sucesso|4103206
7463|PR|Borrazópolis|4103305
7465|PR|Cafeara|4103404
7467|PR|Califórnia|4103503
7469|PR|Cambará|4103602
7471|PR|Cambé|4103701
7473|PR|Cambira|4103800
7475|PR|Campina da Lagoa|4103909
7477|PR|Campina Grande do Sul|4104006
7479|PR|Campo do Tenente|4104105
7481|PR|Campo Largo|4104204
7483|PR|Campo Mourão|4104303
7485|PR|Cândido de Abreu|4104402
7487|PR|Capanema|4104501
7489|PR|Capitão Leônidas Marques|4104600
7491|PR|Carlópolis|4104709
7493|PR|Cascavel|4104808
7495|PR|Castro|4104907
7497|PR|Catanduvas|4105003
7499|PR|Centenário do Sul|4105102
7501|PR|Cerro Azul|4105201
7503|PR|Chopinzinho|4105409
7505|PR|Cianorte|4105508
7507|PR|Cidade Gaúcha|4105607
7509|PR|Clevelândia|4105706
7511|PR|Mangueirinha|4114401
7513|PR|Colombo|4105805
7515|PR|Colorado|4105904
7517|PR|Congonhinhas|4106001
7519|PR|Conselheiro Mairinck|4106100
7521|PR|Contenda|4106209
7523|PR|Corbélia|4106308
7525|PR|Cornélio Procópio|4106407
7527|PR|Coronel Vivida|4106506
7529|PR|Cruzeiro do Oeste|4106605
7531|PR|Cruzeiro do Sul|4106704
7533|PR|Cruz Machado|4106803
7535|PR|Curitiba|4106902
7537|PR|Curiúva|4107009
7539|PR|Diamante do Norte|4107108
7541|PR|Dois Vizinhos|4107207
7543|PR|Doutor Camargo|4107306
7545|PR|Enéas Marques|4107405
7547|PR|Engenheiro Beltrão|4107504
7549|PR|Faxinal|4107603
7551|PR|Fênix|4107702
7553|PR|Floraí|4107801
7555|PR|Floresta|4107900
7557|PR|Florestópolis|4108007
7559|PR|Flórida|4108106
7561|PR|Formosa do Oeste|4108205
7563|PR|Foz do Iguaçu|4108304
7565|PR|Francisco Beltrão|4108403
7567|PR|General Carneiro|4108502
7569|PR|Goioerê|4108601
7571|PR|Guaíra|4108809
7573|PR|Guairaçá|4108908
7575|PR|Guapirama|4109005
7577|PR|Guaporema|4109104
7579|PR|Guaraci|4109203
7581|PR|Guaraniaçu|4109302
7583|PR|Guarapuava|4109401
7585|PR|Guaraqueçaba|4109500
7587|PR|Guaratuba|4109609
7589|PR|Ibaiti|4109708
7591|PR|Ibiporã|4109807
7593|PR|Icaraíma|4109906
7595|PR|Iguaraçu|4110003
7597|PR|Imbituva|4110102
7599|PR|Inácio Martins|4110201
7601|PR|Inajá|4110300
7603|PR|Ipiranga|4110508
7605|PR|Iporã|4110607
7607|PR|Irati|4110706
7609|PR|Iretama|4110805
7611|PR|Itaguajé|4110904
7613|PR|Itambaracá|4111001
7615|PR|Itambé|4111100
7617|PR|Itapejara d'Oeste|4111209
7619|PR|Itaúna do Sul|4111308
7621|PR|Ivaí|4111407
7623|PR|Ivaiporã|4111506
7625|PR|Ivatuba|4111605
7627|PR|Jaboti|4111704
7629|PR|Jacarezinho|4111803
7631|PR|Jaguapitã|4111902
7633|PR|Jaguariaíva|4112009
7635|PR|Jandaia do Sul|4112108
7637|PR|Janiópolis|4112207
7639|PR|Japira|4112306
7641|PR|Japurá|4112405
7643|PR|Jardim Alegre|4112504
7645|PR|Jardim Olinda|4112603
7647|PR|Jataizinho|4112702
7649|PR|Joaquim Távora|4112801
7651|PR|Jundiaí do Sul|4112900
7653|PR|Jussara|4113007
7655|PR|Kaloré|4113106
7657|PR|Lapa|4113205
7659|PR|Laranjeiras do Sul|4113304
7661|PR|Leópolis|4113403
7663|PR|Loanda|4113502
7665|PR|Lobato|4113601
7667|PR|Londrina|4113700
7669|PR|Lupionópolis|4113809
7671|PR|Mallet|4113908
7673|PR|Mamborê|4114005
7675|PR|Mandaguaçu|4114104
7677|PR|Mandaguari|4114203
7679|PR|Mandirituba|4114302
7681|PR|Manoel Ribas|4114500
7683|PR|Marechal Cândido Rondon|4114609
7685|PR|Maria Helena|4114708
7687|PR|Marialva|4114807
7689|PR|Mariluz|4115101
7691|PR|Maringá|4115200
7693|PR|Mariópolis|4115309
7695|PR|Marmeleiro|4115408
7697|PR|Marumbi|4115507
7699|PR|Matelândia|4115606
7701|PR|Medianeira|4115804
7703|PR|Mirador|4115903
7705|PR|Miraselva|4116000
7707|PR|Moreira Sales|4116109
7709|PR|Morretes|4116208
7711|PR|Munhoz de Melo|4116307
7713|PR|Nossa Senhora das Graças|4116406
7715|PR|Nova Aliança do Ivaí|4116505
7717|PR|Nova América da Colina|4116604
7719|PR|Nova Cantu|4116802
7721|PR|Nova Esperança|4116901
7723|PR|Nova Fátima|4117008
7725|PR|Nova Londrina|4117107
7727|PR|Ortigueira|4117305
7729|PR|Ourizona|4117404
7731|PR|Paiçandu|4117503
7733|PR|Palmas|4117602
7735|PR|Palmeira|4117701
7737|PR|Palmital|4117800
7739|PR|Palotina|4117909
7741|PR|Paraíso do Norte|4118006
7743|PR|Paranacity|4118105
7745|PR|Paranaguá|4118204
7747|PR|Paranapoema|4118303
7749|PR|Paranavaí|4118402
7751|PR|Pato Branco|4118501
7753|PR|Paula Freitas|4118600
7755|PR|Paulo Frontin|4118709
7757|PR|Peabiru|4118808
7759|PR|Pérola d'Oeste|4119004
7761|PR|Piên|4119103
7763|PR|Pinhalão|4119202
7765|PR|Pinhão|4119301
7767|PR|Piraí do Sul|4119400
7769|PR|Piraquara|4119509
7771|PR|Pitanga|4119608
7773|PR|Planaltina do Paraná|4119707
7775|PR|Planalto|4119806
7777|PR|Ponta Grossa|4119905
7779|PR|Porecatu|4120002
7781|PR|Porto Amazonas|4120101
7783|PR|Porto Rico|4120200
7785|PR|Porto Vitória|4120309
7787|PR|Presidente Castelo Branco|4120408
7789|PR|Primeiro de Maio|4120507
7791|PR|Prudentópolis|4120606
7793|PR|Quatiguá|4120705
7795|PR|Quatro Barras|4120804
7797|PR|Querência do Norte|4121000
7799|PR|Quinta do Sol|4121109
7801|PR|Quitandinha|4121208
7803|PR|Rancho Alegre|4121307
7805|PR|Realeza|4121406
7807|PR|Rebouças|4121505
7809|PR|Renascença|4121604
7811|PR|Reserva|4121703
7813|PR|Ribeirão Claro|4121802
7815|PR|Ribeirão do Pinhal|4121901
7817|PR|Rio Azul|4122008
7819|PR|Rio Bom|4122107
7821|PR|Rio Branco do Sul|4122206
7823|PR|Rio Negro|4122305
7825|PR|Rolândia|4122404
7827|PR|Roncador|4122503
7829|PR|Rondon|4122602
7831|PR|Sabáudia|4122701
7833|PR|Salgado Filho|4122800
7835|PR|Salto do Itararé|4122909
7837|PR|Salto do Lontra|4123006
7839|PR|Santa Amélia|4123105
7841|PR|Santa Cecília do Pavão|4123204
7843|PR|Santa Cruz de Monte Castelo|4123303
7845|PR|Santa Fé|4123402
7847|PR|Santa Inês|4123600
7849|PR|Santa Isabel do Ivaí|4123709
7851|PR|Santa Izabel do Oeste|4123808
7853|PR|Santa Mariana|4123907
7855|PR|Santana do Itararé|4124004
7857|PR|Santo Antônio do Sudoeste|4124400
7859|PR|Santo Antônio da Platina|4124103
7861|PR|Santo Antônio do Caiuá|4124202
7863|PR|Santo Antônio do Paraíso|4124301
7865|PR|Santo Inácio|4124509
7867|PR|São Carlos do Ivaí|4124608
7869|PR|São Jerônimo da Serra|4124707
7871|PR|São João|4124806
7873|PR|São João do Caiuá|4124905
7875|PR|São João do Ivaí|4125001
7877|PR|São João do Triunfo|4125100
7879|PR|São Jorge do Ivaí|4125308
7881|PR|São Jorge d'Oeste|4125209
7883|PR|São José da Boa Vista|4125407
7885|PR|São José dos Pinhais|4125506
7887|PR|São Mateus do Sul|4125605
7889|PR|São Miguel do Iguaçu|4125704
7891|PR|São Pedro do Ivaí|4125803
7893|PR|São Pedro do Paraná|4125902
7895|PR|São Sebastião da Amoreira|4126009
7897|PR|São Tomé|4126108
7899|PR|Sapopema|4126207
7901|PR|Sengés|4126306
7903|PR|Sertaneja|4126405
7905|PR|Sertanópolis|4126504
7907|PR|Siqueira Campos|4126603
7909|PR|Tamboara|4126702
7911|PR|Tapejara|4126801
7913|PR|Teixeira Soares|4127007
7915|PR|Telêmaco Borba|4127106
7917|PR|Terra Boa|4127205
7919|PR|Terra Rica|4127304
7921|PR|Terra Roxa|4127403
7923|PR|Tibagi|4127502
7925|PR|Tijucas do Sul|4127601
7927|PR|Toledo|4127700
7929|PR|Tomazina|4127809
7931|PR|Tuneiras do Oeste|4127908
7933|PR|Ubiratã|4128005
7935|PR|Umuarama|4128104
7937|PR|União da Vitória|4128203
7939|PR|Uniflor|4128302
7941|PR|Uraí|4128401
7943|PR|Wenceslau Braz|4128500
7945|PR|Verê|4128609
7947|PR|Vitorino|4128708
7949|PR|Xambrê|4128807
7951|PR|Altônia|4100509
7953|PR|Assis Chateaubriand|4102000
7955|PR|Quedas do Iguaçu|4120903
7957|PR|Céu Azul|4105300
7959|PR|Grandes Rios|4108700
7961|PR|Indianópolis|4110409
7963|PR|Matinhos|4115705
7965|PR|Nova Aurora|4116703
7967|PR|Nova Olímpia|4117206
7969|PR|Pérola|4118907
7971|PR|Santa Helena|4123501
7973|PR|Tapira|4126900
7975|PR|Marilena|4115002
7977|PR|Francisco Alves|4108320
7979|PR|Nova Santa Rosa|4117222
7981|PR|Boa Vista da Aparecida|4103057
7983|PR|Braganey|4103354
7985|PR|Cafelândia|4103453
7987|PR|Três Barras do Paraná|4127858
7989|PR|Vera Cruz do Oeste|4128559
7991|PR|Pranchita|4120358
7993|PR|Tupãssi|4127957
7995|PR|Nova Prata do Iguaçu|4117255
7997|PR|Jesuítas|4112751
7999|PR|São Jorge do Patrocínio|4125357
8001|SC|Abelardo Luz|4200101
8003|SC|Agrolândia|4200200
8005|SC|Agronômica|4200309
8007|SC|Água Doce|4200408
8009|SC|Águas de Chapecó|4200507
8011|SC|Águas Mornas|4200606
8013|SC|Alfredo Wagner|4200705
8015|SC|Anchieta|4200804
8017|SC|Angelina|4200903
8019|SC|Anita Garibaldi|4201000
8021|SC|Anitápolis|4201109
8023|SC|Antônio Carlos|4201208
8025|SC|Araquari|4201307
8027|SC|Araranguá|4201406
8029|SC|Armazém|4201505
8031|SC|Arroio Trinta|4201604
8033|SC|Ascurra|4201703
8035|SC|Atalanta|4201802
8037|SC|Aurora|4201901
8039|SC|Balneário Camboriú|4202008
8041|SC|Barra Velha|4202107
8043|SC|Benedito Novo|4202206
8045|SC|Biguaçu|4202305
8047|SC|Blumenau|4202404
8049|SC|Bom Retiro|4202602
8051|SC|Botuverá|4202701
8053|SC|Braço do Norte|4202800
8055|SC|Brusque|4202909
8057|SC|Caçador|4203006
8059|SC|Caibi|4203105
8061|SC|Camboriú|4203204
8063|SC|Campo Alegre|4203303
8065|SC|Campo Belo do Sul|4203402
8067|SC|Campo Erê|4203501
8069|SC|Campos Novos|4203600
8071|SC|Canelinha|4203709
8073|SC|Canoinhas|4203808
8075|SC|Capinzal|4203907
8077|SC|Catanduvas|4204004
8079|SC|Caxambu do Sul|4204103
8081|SC|Chapecó|4204202
8083|SC|Concórdia|4204301
8085|SC|Coronel Freitas|4204400
8087|SC|Corupá|4204509
8089|SC|Criciúma|4204608
8091|SC|Cunha Porã|4204707
8093|SC|Curitibanos|4204806
8095|SC|Descanso|4204905
8097|SC|Dionísio Cerqueira|4205001
8099|SC|Dona Emma|4205100
8101|SC|Erval Velho|4205209
8103|SC|Faxinal dos Guedes|4205308
8105|SC|Florianópolis|4205407
8107|SC|Fraiburgo|4205506
8109|SC|Galvão|4205605
8111|SC|Governador Celso Ramos|4206009
8113|SC|Garopaba|4205704
8115|SC|Garuva|4205803
8117|SC|Gaspar|4205902
8119|SC|Grão-Pará|4206108
8121|SC|Gravatal|4206207
8123|SC|Guabiruba|4206306
8125|SC|Guaraciaba|4206405
8127|SC|Guaramirim|4206504
8129|SC|Guarujá do Sul|4206603
8131|SC|Herval d'Oeste|4206702
8133|SC|Ibicaré|4206801
8135|SC|Ibirama|4206900
8137|SC|Içara|4207007
8139|SC|Ilhota|4207106
8141|SC|Imaruí|4207205
8143|SC|Imbituba|4207304
8145|SC|Imbuia|4207403
8147|SC|Indaial|4207502
8149|SC|Ipira|4207601
8151|SC|Ipumirim|4207700
8153|SC|Irani|4207809
8155|SC|Irineópolis|4207908
8157|SC|Itá|4208005
8159|SC|Itaiópolis|4208104
8161|SC|Itajaí|4208203
8163|SC|Itapema|4208302
8165|SC|Itapiranga|4208401
8167|SC|Ituporanga|4208500
8169|SC|Jaborá|4208609
8171|SC|Jacinto Machado|4208708
8173|SC|Jaguaruna|4208807
8175|SC|Jaraguá do Sul|4208906
8177|SC|Joaçaba|4209003
8179|SC|Joinville|4209102
8181|SC|Lacerdópolis|4209201
8183|SC|Lages|4209300
8185|SC|Laguna|4209409
8187|SC|Laurentino|4209508
8189|SC|Lauro Müller|4209607
8191|SC|Lebon Régis|4209706
8193|SC|Leoberto Leal|4209805
8195|SC|Lontras|4209904
8197|SC|Luiz Alves|4210001
8199|SC|Mafra|4210100
8201|SC|Major Gercino|4210209
8203|SC|Major Vieira|4210308
8205|SC|Maravilha|4210506
8207|SC|Massaranduba|4210605
8209|SC|Matos Costa|4210704
8211|SC|Meleiro|4210803
8213|SC|Modelo|4210902
8215|SC|Mondaí|4211009
8217|SC|Monte Castelo|4211108
8219|SC|Morro da Fumaça|4211207
8221|SC|Navegantes|4211306
8223|SC|Nova Erechim|4211405
8225|SC|Nova Trento|4211504
8227|SC|Nova Veneza|4211603
8229|SC|Orleans|4211702
8231|SC|Ouro|4211801
8233|SC|Palhoça|4211900
8235|SC|Palma Sola|4212007
8237|SC|Palmitos|4212106
8239|SC|Papanduva|4212205
8241|SC|Paulo Lopes|4212304
8243|SC|Pedras Grandes|4212403
8245|SC|Penha|4212502
8247|SC|Peritiba|4212601
8249|SC|Petrolândia|4212700
8251|SC|Balneário Piçarras|4212809
8253|SC|Pinhalzinho|4212908
8255|SC|Pinheiro Preto|4213005
8257|SC|Piratuba|4213104
8259|SC|Pomerode|4213203
8261|SC|Ponte Alta|4213302
8263|SC|Ponte Serrada|4213401
8265|SC|Porto Belo|4213500
8267|SC|Porto União|4213609
8269|SC|Pouso Redondo|4213708
8271|SC|Praia Grande|4213807
8273|SC|Presidente Castello Branco|4213906
8275|SC|Presidente Getúlio|4214003
8277|SC|Presidente Nereu|4214102
8279|SC|Quilombo|4214201
8281|SC|Rancho Queimado|4214300
8283|SC|Rio das Antas|4214409
8285|SC|Rio do Campo|4214508
8287|SC|Rio do Oeste|4214607
8289|SC|Rio dos Cedros|4214706
8291|SC|Rio do Sul|4214805
8293|SC|Rio Fortuna|4214904
8295|SC|Rio Negrinho|4215000
8297|SC|Rodeio|4215109
8299|SC|Romelândia|4215208
8301|SC|Salete|4215307
8303|SC|Salto Veloso|4215406
8305|SC|Santa Cecília|4215505
8307|SC|Santa Rosa de Lima|4215604
8309|SC|Santo Amaro da Imperatriz|4215703
8311|SC|São Bento do Sul|4215802
8313|SC|São Bonifácio|4215901
8315|SC|São Carlos|4216008
8317|SC|São Domingos|4216107
8319|SC|São Francisco do Sul|4216206
8321|SC|São João Batista|4216305
8323|SC|São João do Sul|4216404
8325|SC|São Joaquim|4216503
8327|SC|São José|4216602
8329|SC|São José do Cedro|4216701
8331|SC|São José do Cerrito|4216800
8333|SC|São Lourenço do Oeste|4216909
8335|SC|São Ludgero|4217006
8337|SC|São Martinho|4217105
8339|SC|São Miguel do Oeste|4217204
8341|SC|Saudades|4217303
8343|SC|Schroeder|4217402
8345|SC|Seara|4217501
8347|SC|Siderópolis|4217600
8349|SC|Sombrio|4217709
8351|SC|Taió|4217808
8353|SC|Tangará|4217907
8355|SC|Tijucas|4218004
8357|SC|Timbó|4218202
8359|SC|Três Barras|4218301
8361|SC|Treze de Maio|4218400
8363|SC|Treze Tílias|4218509
8365|SC|Trombudo Central|4218608
8367|SC|Tubarão|4218707
8369|SC|Turvo|4218806
8371|SC|Urubici|4218905
8373|SC|Urussanga|4219002
8375|SC|Vargeão|4219101
8377|SC|Vidal Ramos|4219200
8379|SC|Videira|4219309
8381|SC|Witmarsum|4219408
8383|SC|Xanxerê|4219507
8385|SC|Xavantina|4219606
8387|SC|Xaxim|4219705
8389|SC|Bom Jardim da Serra|4202503
8391|SC|Maracajá|4210407
8393|SC|Timbé do Sul|4218103
8395|SC|Correia Pinto|4204558
8397|SC|Otacílio Costa|4211751
8399|RS|Ipê|4310439
8401|RS|Ibarama|4309753
8403|RS|Harmonia|4309555
8405|RS|Guabiju|4309258
8407|RS|Glorinha|4309050
8409|RS|Faxinalzinho|4308052
8411|RS|Fagundes Varela|4307864
8413|RS|Eugênio de Castro|4307831
8415|RS|Ernestina|4307054
8417|RS|Erebango|4306973
8419|RS|Entre-Ijuís|4306932
8421|RS|Entre Rios do Sul|4306957
8423|RS|Eldorado do Sul|4306767
8425|RS|Doutor Maurício Cardoso|4306734
8427|RS|Dois Lajeados|4306452
8429|RS|Dezesseis de Novembro|4306353
8431|RS|Cristal|4306056
8433|RS|Cidreira|4305454
8435|RS|Cerro Grande do Sul|4305173
8437|RS|Cerro Grande|4305157
8439|RS|Cerro Branco|4305132
8441|RS|Caseiros|4304952
8443|RS|Capela de Santana|4304689
8445|RS|Campos Borges|4304101
8447|RS|Camargo|4303558
8449|RS|Brochier|4302659
8451|PR|Cantagalo|4104451
8453|PR|Turvo|4127965
8455|PR|Altamira do Paraná|4100459
8457|PR|Figueira|4107751
8459|PR|Lunardelli|4113759
8461|PR|Sarandi|4126256
8463|PR|Juranda|4112959
8465|PR|Douradina|4107256
8467|PR|Santa Terezinha de Itaipu|4124053
8469|PR|Missal|4116059
8471|PR|São José das Palmeiras|4125456
8473|PR|Rosário do Ivaí|4122651
8475|PR|Campo Bonito|4104055
8477|PR|Sulina|4126652
8479|PR|Corumbataí do Sul|4106555
8481|PR|Luiziana|4113734
8483|RS|Boqueirão do Leão|4302451
8485|RS|Barão|4301651
8487|RS|Áurea|4301552
8489|RS|Arroio do Sal|4301057
8491|RS|André da Rocha|4300661
8493|RS|Amaral Ferrador|4300638
8495|RS|Alto Alegre|4300554
8497|RS|Alegria|4300455
8499|RS|Água Santa|4300059
8501|RS|Agudo|4300109
8503|RS|Ajuricaba|4300208
8505|RS|Alecrim|4300307
8507|RS|Alegrete|4300406
8509|RS|Alpestre|4300505
8511|RS|Alvorada|4300604
8513|RS|Anta Gorda|4300703
8515|RS|Antônio Prado|4300802
8517|RS|Aratiba|4300901
8519|RS|Arroio do Meio|4301008
8521|RS|Arroio dos Ratos|4301107
8523|RS|Arroio do Tigre|4301206
8525|RS|Arroio Grande|4301305
8527|RS|Arvorezinha|4301404
8529|RS|Augusto Pestana|4301503
8531|RS|Bagé|4301602
8533|RS|Barão de Cotegipe|4301701
8535|RS|Barracão|4301800
8537|RS|Barra do Ribeiro|4301909
8539|RS|Barros Cassal|4302006
8541|RS|Bento Gonçalves|4302105
8543|RS|Boa Vista do Buricá|4302204
8545|RS|Bom Jesus|4302303
8547|RS|Bom Retiro do Sul|4302402
8549|RS|Bossoroca|4302501
8551|RS|Braga|4302600
8553|RS|Butiá|4302709
8555|RS|Caçapava do Sul|4302808
8557|RS|Cacequi|4302907
8559|RS|Cachoeira do Sul|4303004
8561|RS|Cachoeirinha|4303103
8563|RS|Cacique Doble|4303202
8565|RS|Caibaté|4303301
8567|RS|Caiçara|4303400
8569|RS|Camaquã|4303509
8571|RS|Cambará do Sul|4303608
8573|RS|Campina das Missões|4303707
8575|RS|Campinas do Sul|4303806
8577|RS|Campo Bom|4303905
8579|RS|Campo Novo|4304002
8581|RS|Candelária|4304200
8583|RS|Cândido Godói|4304309
8585|RS|Canela|4304408
8587|RS|Canguçu|4304507
8589|RS|Canoas|4304606
8591|RS|Carazinho|4304705
8593|RS|Carlos Barbosa|4304804
8595|RS|Casca|4304903
8597|RS|Catuípe|4305009
8599|RS|Caxias do Sul|4305108
8601|RS|Cerro Largo|4305207
8603|RS|Chapada|4305306
8605|RS|Chiapetta|4305405
8607|RS|Ciríaco|4305504
8609|RS|Colorado|4305603
8611|RS|Condor|4305702
8613|RS|Constantina|4305801
8615|RS|Coronel Bicaco|4305900
8617|RS|Crissiumal|4306007
8619|RS|Cruz Alta|4306106
8621|RS|Cruzeiro do Sul|4306205
8623|RS|David Canabarro|4306304
8625|RS|Dois Irmãos|4306403
8627|RS|Dom Feliciano|4306502
8629|RS|Dom Pedrito|4306601
8631|RS|Dona Francisca|4306700
8633|RS|Encantado|4306809
8635|RS|Encruzilhada do Sul|4306908
8637|RS|Erechim|4307005
8639|RS|Herval|4307104
8641|RS|Erval Grande|4307203
8643|RS|Erval Seco|4307302
8645|RS|Esmeralda|4307401
8647|RS|Espumoso|4307500
8649|RS|Estância Velha|4307609
8651|RS|Esteio|4307708
8653|RS|Estrela|4307807
8655|RS|Farroupilha|4307906
8657|RS|Faxinal do Soturno|4308003
8659|RS|Feliz|4308102
8661|RS|Flores da Cunha|4308201
8663|RS|Fontoura Xavier|4308300
8665|RS|Formigueiro|4308409
8667|RS|Frederico Westphalen|4308508
8669|RS|Garibaldi|4308607
8671|RS|Gaurama|4308706
8673|RS|General Câmara|4308805
8675|RS|São Vicente do Sul|4319802
8677|RS|Getúlio Vargas|4308904
9359|GO|Flores de Goiás|5207907
9361|GO|Formosa|5208004
9363|GO|Formoso|5208103
9365|TO|Formoso do Araguaia|1708205
9367|GO|Goianápolis|5208400
9369|GO|Goiandira|5208509
9371|GO|Goianésia|5208608
9373|GO|Goiânia|5208707
9375|GO|Goianira|5208806
9377|GO|Goiás|5208905
9379|GO|Goiatuba|5209101
9381|GO|Guapó|5209200
9383|GO|Guarani de Goiás|5209408
9385|TO|Gurupi|1709500
9387|GO|Heitoraí|5209606
9389|GO|Hidrolândia|5209705
9391|GO|Hidrolina|5209804
9393|GO|Iaciara|5209903
9395|GO|Inhumas|5210000
9397|GO|Ipameri|5210109
9399|GO|Iporá|5210208
9401|GO|Israelândia|5210307
9403|GO|Itaberaí|5210406
9405|TO|Itacajá|1710508
9407|GO|Itaguaru|5210604
9409|TO|Itaguatins|1710706
9411|GO|Itajá|5210802
9413|GO|Itapaci|5210901
9415|GO|Itapirapuã|5211008
9417|TO|Itaporã do Tocantins|1711100
9419|GO|Itapuranga|5211206
9421|GO|Itarumã|5211305
9423|GO|Itauçu|5211404
9425|GO|Itumbiara|5211503
9427|GO|Ivolândia|5211602
9429|GO|Jandaia|5211701
9431|GO|Jaraguá|5211800
9433|GO|Jataí|5211909
9435|GO|Jaupaci|5212006
9437|GO|Joviânia|5212105
9439|GO|Jussara|5212204
9441|TO|Aliança do Tocantins|1700350
9443|GO|Leopoldo de Bulhões|5212303
9445|GO|Luziânia|5212501
9447|GO|Mairipotaba|5212600
9449|GO|Mambaí|5212709
9451|GO|Mara Rosa|5212808
9453|GO|Marzagão|5212907
9455|GO|Paranaiguara|5216304
9457|GO|Maurilândia|5213004
9459|GO|Mineiros|5213103
9461|TO|Miracema do Tocantins|1713205
9463|TO|Miranorte|1713304
9465|GO|Moiporá|5213400
9467|GO|Monte Alegre de Goiás|5213509
9469|TO|Monte do Carmo|1713601
9471|GO|Montes Claros de Goiás|5213707
9473|GO|Morrinhos|5213806
9475|GO|Mossâmedes|5213905
9477|GO|Mozarlândia|5214002
9479|GO|Mutunópolis|5214101
9481|TO|Natividade|1714203
9483|TO|Nazaré|1714302
9485|GO|Nazário|5214408
9487|GO|Nerópolis|5214507
9489|GO|Niquelândia|5214606
9491|GO|Nova América|5214705
9493|GO|Nova Aurora|5214804
9495|GO|Nova Roma|5214903
9497|GO|Nova Veneza|5215009
9499|TO|Novo Acordo|1715101
9501|GO|Novo Brasil|5215207
9503|GO|Orizona|5215306
9505|GO|Ouro Verde de Goiás|5215405
9507|GO|Ouvidor|5215504
9509|GO|Padre Bernardo|5215603
9511|GO|Palmeiras de Goiás|5215702
9513|GO|Palmelo|5215801
9515|GO|Palminópolis|5215900
9517|GO|Panamá|5216007
9519|TO|Paraíso do Tocantins|1716109
9521|TO|Paranã|1716208
9523|GO|Paraúna|5216403
9525|TO|Pedro Afonso|1716505
9527|TO|Peixe|1716604
9529|TO|Colméia|1716703
9531|GO|Petrolina de Goiás|5216809
9533|TO|Goiatins|1709005
9535|GO|Pilar de Goiás|5216908
9537|TO|Pindorama do Tocantins|1717008
9539|GO|Piracanjuba|5217104
9541|GO|Piranhas|5217203
9543|GO|Pirenópolis|5217302
9545|GO|Pires do Rio|5217401
9547|TO|Pium|1717503
9549|GO|Pontalina|5217708
9551|TO|Ponte Alta do Bom Jesus|1717800
9553|TO|Ponte Alta do Tocantins|1717909
9555|GO|Porangatu|5218003
9557|GO|Portelândia|5218102
9559|TO|Porto Nacional|1718204
9561|GO|Posse|5218300
9563|GO|Quirinópolis|5218508
9565|GO|Rialma|5218607
9567|GO|Rianápolis|5218706
9569|TO|Lizarda|1712405
9707|EX|Exterior|0
1070|GO|Campo Limpo de Goiás|5204854
1072|GO|Gameleira de Goiás|5208152
1074|GO|Ipiranga de Goiás|5210158
1076|GO|Lagoa Santa|5212253
1078|MT|Bom Jesus do Araguaia|5101852
1080|MT|Colniza|5103254
1082|MT|Conquista D'Oeste|5103361
1084|MT|Curvelândia|5103437
1086|MT|Nova Nazaré|5106174
1088|MT|Nova Santa Helena|5106190
1090|MT|Novo Santo Antônio|5106315
1092|MT|Rondolândia|5107578
1110|BA|Barrocas|2903276
1112|BA|Luís Eduardo Magalhães|2919553
1114|ES|Governador Lindenberg|3202256
1180|PI|Nazária|2206720
1190|PA|Mojuí dos Campos|1504752
1192|SC|Balneário Rincão|4220000
1194|SC|Pescaria Brava|4212650
1196|MS|Paraíso das Águas|5006275
8679|RS|Giruá|4309001
8681|RS|Gramado|4309100
8683|RS|Gravataí|4309209
8685|RS|Guaíba|4309308
8687|RS|Guaporé|4309407
8689|RS|Guarani das Missões|4309506
8691|RS|Horizontina|4309605
8693|RS|Charqueadas|4305355
8695|RS|Humaitá|4309704
8697|RS|Ibiaçá|4309803
8699|RS|Ibiraiaras|4309902
8701|RS|Ibirubá|4310009
8703|RS|Igrejinha|4310108
8705|RS|Ijuí|4310207
8707|RS|Ilópolis|4310306
8709|RS|Independência|4310405
8711|RS|Iraí|4310504
8713|RS|Itaqui|4310603
8715|RS|Itatiba do Sul|4310702
8717|RS|Ivoti|4310801
8719|RS|Jacutinga|4310900
8721|RS|Jaguarão|4311007
8723|RS|Jaguari|4311106
8725|RS|Júlio de Castilhos|4311205
8727|RS|Lagoa Vermelha|4311304
8729|RS|Lajeado|4311403
8731|RS|Lavras do Sul|4311502
8733|RS|Liberato Salzano|4311601
8735|RS|Machadinho|4311700
8737|RS|Marau|4311809
8739|RS|Marcelino Ramos|4311908
8741|RS|Mariano Moro|4312005
8743|RS|Mata|4312104
8745|RS|Maximiliano de Almeida|4312203
8747|RS|Miraguaí|4312302
8749|RS|Montenegro|4312401
8751|RS|Mostardas|4312500
8753|RS|Muçum|4312609
8755|RS|Não-Me-Toque|4312658
8757|RS|Nonoai|4312708
8759|RS|Nova Araçá|4312807
8761|RS|Nova Bassano|4312906
8763|RS|Nova Bréscia|4313003
8765|RS|Nova Palma|4313102
8767|RS|Nova Petrópolis|4313201
8769|RS|Nova Prata|4313300
8771|RS|Novo Hamburgo|4313409
8773|RS|Osório|4313508
8775|RS|Paim Filho|4313607
8777|RS|Palmeira das Missões|4313706
8779|RS|Palmitinho|4313805
8781|RS|Panambi|4313904
8783|RS|Paraí|4314001
8785|RS|Passo Fundo|4314100
8787|RS|Pedro Osório|4314209
8789|RS|Pejuçara|4314308
8791|RS|Pelotas|4314407
8793|RS|Pinheiro Machado|4314506
8795|RS|Piratini|4314605
8797|RS|Planalto|4314704
8799|RS|Portão|4314803
8801|RS|Porto Alegre|4314902
8803|RS|Porto Lucena|4315008
8805|RS|Porto Xavier|4315107
8807|RS|Putinga|4315206
8809|RS|Quaraí|4315305
8811|RS|Redentora|4315404
8813|RS|Restinga Sêca|4315503
8815|RS|Rio Grande|4315602
8817|RS|Rio Pardo|4315701
8819|RS|Roca Sales|4315800
8821|RS|Rodeio Bonito|4315909
8823|RS|Rolante|4316006
8825|RS|Ronda Alta|4316105
8827|RS|Rondinha|4316204
8829|RS|Roque Gonzales|4316303
8831|RS|Rosário do Sul|4316402
8833|RS|Salvador do Sul|4316501
8835|RS|Sananduva|4316600
8837|RS|Santa Bárbara do Sul|4316709
8839|RS|Santa Cruz do Sul|4316808
8841|RS|Santa Maria|4316907
8843|RS|Santana da Boa Vista|4317004
8845|RS|Sant'Ana do Livramento|4317103
8847|RS|Santa Rosa|4317202
8849|RS|Santa Vitória do Palmar|4317301
8851|RS|Santiago|4317400
8853|RS|Santo Ângelo|4317509
8855|RS|Santo Antônio da Patrulha|4317608
8857|RS|Santo Antônio das Missões|4317707
8859|RS|Santo Augusto|4317806
8861|RS|Santo Cristo|4317905
8863|RS|São Borja|4318002
8865|RS|São Francisco de Assis|4318101
8867|RS|São Francisco de Paula|4318200
8869|RS|São Gabriel|4318309
8871|RS|São Jerônimo|4318408
8873|RS|São José do Norte|4318507
8875|RS|São José do Ouro|4318606
8877|RS|São Leopoldo|4318705
8879|RS|São Lourenço do Sul|4318804
8881|RS|São Luiz Gonzaga|4318903
8883|RS|São Marcos|4319000
8885|RS|São Martinho|4319109
8887|RS|São Nicolau|4319208
8889|RS|São Paulo das Missões|4319307
8891|RS|São Pedro do Sul|4319406
8893|RS|São Sebastião do Caí|4319505
8895|RS|São Sepé|4319604
8897|RS|São Valentim|4319703
8899|RS|Sapiranga|4319901
8901|RS|Sapucaia do Sul|4320008
8903|RS|Sarandi|4320107
8905|RS|Seberi|4320206
8907|RS|Selbach|4320305
8909|RS|Serafina Corrêa|4320404
8911|RS|Sertão|4320503
8913|RS|Severiano de Almeida|4320602
8915|RS|Capão da Canoa|4304630
8917|RS|Sobradinho|4320701
8919|RS|Soledade|4320800
8921|RS|Tapejara|4320909
8923|RS|Tapera|4321006
8925|RS|Tapes|4321105
8927|RS|Taquara|4321204
8929|RS|Taquari|4321303
8931|RS|Tenente Portela|4321402
8933|RS|Torres|4321501
8935|RS|Tramandaí|4321600
8937|RS|Três Coroas|4321709
8939|RS|Três de Maio|4321808
8941|RS|Três Passos|4321907
8943|RS|Triunfo|4322004
8945|RS|Tucunduva|4322103
8947|RS|Tupanciretã|4322202
8949|RS|Tuparendi|4322301
8951|RS|Uruguaiana|4322400
8953|RS|Vacaria|4322509
8955|RS|Venâncio Aires|4322608
8957|RS|Vera Cruz|4322707
8959|RS|Veranópolis|4322806
8961|RS|Viadutos|4322905
8963|RS|Viamão|4323002
8965|RS|Vicente Dutra|4323101
8967|RS|Palmares do Sul|4313656
8969|RS|Victor Graeff|4323200
8971|RS|Tavares|4321352
8973|RS|Capão do Leão|4304663
8975|RS|Salto do Jacuí|4316451
8977|RS|Cotiporã|4305959
8979|MT|Colíder|5103205
8981|MT|Nova Brasilândia|5106208
8983|MT|Paranatinga|5106307
8985|MT|Sinop|5107909
8987|MT|Alta Floresta|5100250
8989|MT|Araputanga|5101258
8991|MT|Jauru|5105002
8993|MT|São José dos Quatro Marcos|5107107
8995|MT|Rio Branco|5107206
8997|MT|Salto do Céu|5107750
8999|MT|Pontes e Lacerda|5106752
9001|MT|Acorizal|5100102
9003|MS|Água Clara|5000203
9005|MT|Alto Araguaia|5100300
9007|MT|Alto Garças|5100409
9009|MT|Alto Paraguai|5100508
9011|MS|Amambai|5000609
9013|MS|Anastácio|5000708
9015|MS|Anaurilândia|5000807
9017|MS|Antônio João|5000906
9019|MS|Aparecida do Taboado|5001003
9021|MS|Aquidauana|5001102
9023|MT|Araguainha|5101209
9025|MT|Arenápolis|5101308
9027|MT|Aripuanã|5101407
9029|MS|Bandeirantes|5001508
9031|MT|Barão de Melgaço|5101605
9033|MT|Barra do Bugres|5101704
9035|MT|Barra do Garças|5101803
9037|MS|Bataguassu|5001904
9039|MS|Batayporã|5002001
9041|MS|Bela Vista|5002100
9043|MS|Bonito|5002209
9045|MS|Brasilândia|5002308
9047|MT|Cáceres|5102504
9049|MS|Camapuã|5002605
9051|MS|Campo Grande|5002704
9053|MS|Caracol|5002803
9055|MS|Caarapó|5002407
9057|MS|Cassilândia|5002902
9059|MT|Chapada dos Guimarães|5103007
9061|MS|Corguinho|5003108
9063|MS|Corumbá|5003207
9065|MS|Coxim|5003306
9067|MT|Cuiabá|5103403
9069|MT|Diamantino|5103502
9071|MT|Dom Aquino|5103601
9073|MS|Dourados|5003702
9075|MS|Fátima do Sul|5003801
9077|MT|General Carneiro|5103908
9079|MS|Glória de Dourados|5004007
9081|MS|Guia Lopes da Laguna|5004106
9083|MT|Guiratinga|5104203
9085|MS|Iguatemi|5004304
9087|MS|Inocência|5004403
9089|MS|Itaporã|5004502
9091|MT|Itiquira|5104609
9093|MS|Ivinhema|5004700
9095|MT|Jaciara|5104807
9097|MS|Jaraguari|5004908
9099|MS|Jardim|5005004
9101|MS|Jateí|5005103
9103|MS|Ladário|5005202
9105|MT|Luciara|5105309
9107|MS|Maracaju|5005400
9109|MT|Vila Bela da Santíssima Trindade|5105507
9111|MS|Miranda|5005608
9113|MS|Naviraí|5005707
9115|MS|Nioaque|5005806
9117|MT|Nobres|5105903
9119|MT|Nortelândia|5106000
9121|MT|Nossa Senhora do Livramento|5106109
9123|MS|Nova Andradina|5006200
9125|MS|Paranaíba|5006309
9127|MS|Pedro Gomes|5006408
9129|MT|Poconé|5106505
9131|MS|Ponta Porã|5006606
9133|MT|Ponte Branca|5106703
9135|MT|Porto dos Gaúchos|5106802
9137|MS|Porto Murtinho|5006903
9139|MT|Poxoréu|5107008
9141|MS|Ribas do Rio Pardo|5007109
9143|MS|Rio Brilhante|5007208
9145|MS|Rio Negro|5007307
9147|MS|Rio Verde de Mato Grosso|5007406
9149|MS|Rochedo|5007505
9151|MT|Rondonópolis|5107602
9153|MT|Rosário Oeste|5107701
9155|MT|Santo Antônio do Leverger|5107800
9157|MS|Sidrolândia|5007901
9159|MS|Terenos|5008008
9161|MT|Tesouro|5108105
9163|MT|Torixoréu|5108204
9165|MS|Três Lagoas|5008305
9167|MT|Várzea Grande|5108402
9169|MS|Angélica|5000856
9171|MS|Aral Moreira|5001243
9173|MS|Eldorado|5003751
9175|MS|Deodápolis|5003454
9177|MT|Mirassol d'Oeste|5105622
9179|MS|Mundo Novo|5005681
9181|MT|Pedra Preta|5106372
9183|MT|São Félix do Araguaia|5107859
9185|MT|Tangará da Serra|5107958
9187|MS|Vicentina|5008404
9189|MT|Juscimeira|5105200
9191|MT|Água Boa|5100201
9193|MT|Canarana|5102702
9195|MT|Nova Xavantina|5106257
9197|MT|Santa Terezinha|5107776
9199|MT|São José do Rio Claro|5107305
9201|GO|Abadiânia|5200100
9203|GO|Água Limpa|5200209
9205|GO|Alexânia|5200308
9207|TO|Almas|1700400
9209|GO|Aloândia|5200506
9211|GO|Alto Paraíso de Goiás|5200605
9213|TO|Alvorada|1700707
9215|GO|Alvorada do Norte|5200803
9217|GO|Amorinópolis|5200902
9219|TO|Ananás|1701002
9221|GO|Anápolis|5201108
9223|GO|Anhanguera|5201207
9225|GO|Anicuns|5201306
9227|GO|Aparecida de Goiânia|5201405
9229|GO|Aporé|5201504
9231|GO|Araçu|5201603
9233|GO|Aragarças|5201702
9235|GO|Aragoiânia|5201801
9237|TO|Araguacema|1701903
9239|TO|Araguaçu|1702000
9241|TO|Araguaína|1702109
9243|TO|Araguatins|1702208
9245|TO|Arapoema|1702307
9247|TO|Arraias|1702406
9249|GO|Aruanã|5202502
9251|GO|Aurilândia|5202601
9253|TO|Aurora do Tocantins|1702703
9255|GO|Avelinópolis|5202809
9257|TO|Axixá do Tocantins|1702901
9259|TO|Babaçulândia|1703008
9261|GO|Baliza|5203104
9263|GO|Barro Alto|5203203
9265|GO|Bela Vista de Goiás|5203302
9267|GO|Bom Jardim de Goiás|5203401
9269|GO|Bom Jesus de Goiás|5203500
9271|GO|Brazabrantes|5203609
9273|TO|Brejinho de Nazaré|1703701
9275|GO|Britânia|5203807
9277|GO|Buriti Alegre|5203906
9279|GO|Cabeceiras|5204003
9281|GO|Cachoeira Alta|5204102
9283|GO|Cachoeira de Goiás|5204201
9285|GO|Caçu|5204300
9287|GO|Caiapônia|5204409
9289|GO|Caldas Novas|5204508
9291|GO|Campestre de Goiás|5204607
9293|GO|Campinorte|5204706
9295|GO|Campo Alegre de Goiás|5204805
9297|GO|Campos Belos|5204904
9299|GO|Carmo do Rio Verde|5205000
9301|GO|Catalão|5205109
9303|GO|Caturaí|5205208
9305|GO|Cavalcante|5205307
9307|GO|Ceres|5205406
9309|GO|Divinópolis de Goiás|5208301
9311|TO|Colinas do Tocantins|1705508
9313|TO|Conceição do Tocantins|1705607
9315|GO|Córrego do Ouro|5205703
9317|GO|Corumbá de Goiás|5205802
9319|GO|Corumbaíba|5205901
9321|TO|Couto Magalhães|1706001
9323|TO|Cristalândia|1706100
9325|GO|Cristalina|5206206
9327|GO|Cristianópolis|5206305
9329|GO|Crixás|5206404
9331|GO|Cromínia|5206503
9333|GO|Cumari|5206602
9335|GO|Damianópolis|5206701
9337|GO|Damolândia|5206800
9339|GO|Davinópolis|5206909
9341|TO|Dianópolis|1707009
9343|GO|Diorama|5207105
9345|TO|Dois Irmãos do Tocantins|1707207
9347|TO|Dueré|1707306
9349|GO|Edéia|5207402
9351|GO|Estrela do Norte|5207501
9353|GO|Fazenda Nova|5207600
9355|TO|Filadélfia|1707702
9357|GO|Firminópolis|5207808
9571|GO|Rio Verde|5218805
9573|GO|Rubiataba|5218904
9575|GO|Sanclerlândia|5219001
9577|GO|Santa Bárbara de Goiás|5219100
9579|GO|Santa Cruz de Goiás|5219209
9581|GO|Santa Helena de Goiás|5219308
9583|GO|Santa Rita do Araguaia|5219407
9585|GO|Santa Rosa de Goiás|5219506
9587|GO|Santa Tereza de Goiás|5219605
9589|GO|Santa Terezinha de Goiás|5219704
9591|GO|São Domingos|5219803
9593|GO|São Francisco de Goiás|5219902
9595|GO|Planaltina|5217609
9597|GO|São João d'Aliança|5220009
9599|GO|São Luís de Montes Belos|5220108
9601|GO|São Miguel do Araguaia|5220207
9603|TO|São Sebastião do Tocantins|1720309
9605|GO|São Simão|5220405
9607|GO|Serranópolis|5220504
9609|GO|Silvânia|5220603
9611|GO|Sítio d'Abadia|5220702
9613|TO|Sítio Novo do Tocantins|1720804
9615|TO|Taguatinga|1720903
9617|GO|Taquaral de Goiás|5221007
9619|TO|Tocantínia|1721109
9621|TO|Tocantinópolis|1721208
9623|GO|Três Ranchos|5221304
9625|GO|Trindade|5221403
9627|TO|Guaraí|1709302
9629|TO|Presidente Kennedy|1718402
9631|GO|Turvânia|5221502
9633|GO|Uruaçu|5221601
9635|GO|Uruana|5221700
9637|GO|Urutaí|5221809
9639|GO|Varjão|5221908
9641|GO|Vianópolis|5222005
9643|TO|Xambioá|1722107
9645|GO|Acreúna|5200134
9647|GO|Minaçu|5213087
9649|TO|Palmeirópolis|1715754
9651|GO|Mundo Novo|5214051
9653|GO|Nova Crixás|5214838
9655|GO|Nova Glória|5214861
9657|GO|Vicentinópolis|5222054
9659|TO|Silvanópolis|1720655
9661|GO|Americano do Brasil|5200852
9663|TO|Nova Olinda|1714880
9665|TO|Wanderlândia|1722081
9667|TO|Figueirópolis|1707652
9669|GO|Araguapaz|5202155
9671|GO|Arenópolis|5202353
9673|GO|Cachoeira Dourada|5204250
9675|GO|Doverlândia|5207253
9677|GO|Santo Antônio do Descoberto|5219753
9679|TO|Rio Sono|1718758
9681|GO|Indiara|5209952
9683|TO|Fátima|1707553
9685|TO|Augustinópolis|1702554
9687|GO|Campinaçu|5204656
9689|GO|Santa Isabel|5219357
9691|TO|São Valério|1720499
9693|TO|Barrolândia|1703107
9695|TO|Bernardo Sayão|1703206
9697|TO|Combinado|1705557
9699|TO|Goianorte|1708304
9701|DF|Brasília|5300108
9703|TO|Novo Alegre|1715150
9705|TO|Pequizeiro|1716653
9711|TO|Marianópolis do Tocantins|1712504
9713|TO|Aparecida do Rio Negro|1701101
9715|TO|Buriti do Tocantins|1703800
9717|TO|Caseara|1703909
9719|TO|Divinópolis do Tocantins|1707108
9721|TO|Nova Rosalândia|1715002
9723|TO|Porto Alegre do Tocantins|1718006
9725|TO|Praia Norte|1718303
9727|TO|Sampaio|1718808
9729|TO|Santa Rosa do Tocantins|1718907
9731|TO|Santa Tereza do Tocantins|1719004
9733|TO|Palmas|1721000
9735|GO|Novo Planalto|5215256
9737|GO|Palestina de Goiás|5215652
9739|MS|Paranhos|5006358
9741|MT|Ribeirão Cascalheira|5107180
9743|GO|Santa Fé de Goiás|5219258
9745|MS|Santa Rita do Pardo|5007554
9747|GO|São João da Paraúna|5220058
9749|GO|São Luiz do Norte|5220157
9751|GO|São Miguel do Passa Quatro|5220264
9753|GO|Senador Canedo|5220454
9755|GO|Simolândia|5220686
9757|MS|Sonora|5007935
9759|GO|Teresina de Goiás|5221080
9761|GO|Trombas|5221452
9763|MT|Tapurah|5108006
9765|GO|Turvelândia|5221551
9767|PI|Alagoinha do Piauí|2200251
9769|GO|Adelândia|5200159
9771|GO|Água Fria de Goiás|5200175
9773|MT|Apiacás|5100805
9775|GO|Bonfinópolis|5203559
9777|MT|Campo Novo do Parecis|5102637
9779|MT|Campo Verde|5102678
9781|GO|Campos Verdes|5204953
9783|MT|Castanheira|5102850
9785|GO|Cezarina|5205455
9787|MS|Chapadão do Sul|5002951
9789|MT|Cláudia|5103056
9791|GO|Colinas do Sul|5205521
9793|MS|Dois Irmãos do Buriti|5003488
9795|GO|Edealina|5207352
9797|GO|Faina|5207535
9799|GO|Gouvelândia|5209150
9801|MS|Bodoquena|5002159
9803|MS|Costa Rica|5003256
9805|MS|Douradina|5003504
9807|MS|Itaquiraí|5004601
9809|MS|São Gabriel do Oeste|5007695
9811|MS|Selvíria|5007802
9813|MS|Sete Quedas|5007703
9815|MS|Tacuru|5007950
9817|MS|Taquarussu|5007976
9819|MT|Juara|5105101
9821|RS|Teutônia|4321451
9823|RS|Bom Princípio|4302352
9825|RS|Parobé|4314050
9827|RS|Fortaleza dos Valos|4308458
9829|RS|Jóia|4311155
9831|MT|Juína|5105150
9833|MT|Denise|5103452
9835|AM|Iranduba|1301852
9837|AM|Itamarati|1301951
9839|AM|Manaquiri|1302553
9841|AM|Presidente Figueiredo|1303536
9843|AM|Rio Preto da Eva|1303569
9845|AM|São Sebastião do Uatumã|1303957
9847|AM|Tabatinga|1304062
9849|AM|Uarini|1304260
9851|AM|Tonantins|1304237
9853|CE|Quixelô|2311355
9855|CE|Umirim|2313757
9857|CE|Varjota|2313955
9859|BA|Jaborandi|2917359
9861|MT|Jangada|5104906
9863|MT|Campinápolis|5102603
9865|MT|Cocalinho|5103106
9867|MT|Novo São Joaquim|5106281
9869|MT|Araguaiana|5101001
9871|MT|Primavera do Leste|5107040
9873|MT|Brasnorte|5101902
9875|MT|Porto Esperidião|5106828
9877|MT|Indiavaí|5104500
9879|MT|Reserva do Cabaçal|5107156
9881|MT|Figueirópolis D'Oeste|5103809
9883|MT|Comodoro|5103304
9885|MT|Paranaíta|5106299
9887|MT|Guarantã do Norte|5104104
9889|MT|Nova Canaã do Norte|5106216
9891|MT|Peixoto de Azevedo|5106422
9893|MT|Nova Olímpia|5106232
9895|MT|Porto Alegre do Norte|5106778
9897|MT|Vila Rica|5108600
9899|MT|Marcelândia|5105580
9901|MT|Itaúba|5104559
9903|MT|Novo Horizonte do Norte|5106273
9905|MT|Vera|5108501
9907|MT|Sorriso|5107925
9909|MT|Terra Nova do Norte|5108055
9911|MT|Alto Taquari|5100607
9913|PR|Nova Tebas|4117271
9915|PR|Diamante D'Oeste|4107157
9917|CE|Quiterianópolis|2311264
9919|GO|Itaguari|5210562
9921|MT|Juruena|5105176
9923|MS|Juti|5005152
9925|MT|Lucas do Rio Verde|5105259
9927|GO|Matrinchã|5212956
9929|MT|Matupá|5105606
9931|GO|Mimoso de Goiás|5213053
9933|GO|Montividiu|5213756
9935|GO|Morro Agudo de Goiás|5213855
9937|MT|Nova Mutum|5106224
9939|SC|Abdon Batista|4200051
9941|SC|Apiúna|4201257
9943|SC|Celso Ramos|4204152
9945|SC|Doutor Pedrinho|4205159
9947|PR|Godoy Moreira|4108551
9949|PR|Ibema|4109757
9951|SC|Iporã do Oeste|4207650
9953|SC|Iraceminha|4207759
9955|PR|Ivaté|4111555
9957|SC|José Boiteux|4209151
9959|PR|Lindoeste|4113452
9961|SC|Lindóia do Sul|4209854
9963|SC|Marema|4210555
9965|PR|Ouro Verde do Oeste|4117453
9967|SC|Santa Rosa do Sul|4215653
9969|PR|Santa Tereza do Oeste|4124020
9971|SC|Timbó Grande|4218251
9973|SC|União do Oeste|4218855
9975|SC|Urupema|4218954
9977|SC|Vitor Meireles|4219358
9979|PR|Bom Sucesso do Sul|4103222
9981|PR|Honório Serpa|4109658
9983|PR|Fazenda Rio Grande|4107652
9985|SC|Itapoá|4208450
9989|SC|Serra Alta|4217550
9991|SC|Tunápolis|4218756
9993|GO|Guarinos|5209457
9995|GO|Rio Quente|5218789
9997|MS|Coronel Sapucaia|5003157
`;

let _cache: Municipio[] | null = null;

function parseAll(): Municipio[] {
  if (_cache) return _cache;
  _cache = RAW.trim().split("\n").map((line) => {
    const [tom, uf, nome, ibge] = line.split("|");
    return { tom, uf, nome, ibge };
  });
  return _cache;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function allMunicipios(): Municipio[] {
  return parseAll();
}

export function findMunicipioByTom(tom: string): Municipio | undefined {
  const t = String(tom ?? "").replace(/\D/g, "").padStart(4, "0");
  return parseAll().find((m) => m.tom === t);
}

/** Busca por nome (prefixo primeiro, depois substring); filtra por UF quando dada. */
export function searchMunicipios(query: string, uf?: string, limit = 20): Municipio[] {
  const q = norm(query);
  const ufU = uf ? uf.trim().toUpperCase() : null;
  if (!q && !ufU) return [];
  const pool = ufU ? parseAll().filter((m) => m.uf === ufU) : parseAll();
  if (!q) return pool.slice(0, limit);
  const starts: Municipio[] = [];
  const contains: Municipio[] = [];
  for (const m of pool) {
    const n = norm(m.nome);
    if (n.startsWith(q)) starts.push(m);
    else if (n.includes(q)) contains.push(m);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
