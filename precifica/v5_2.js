'use strict';
/* PAfro Gestão v5.2 — precificação em uma tela + ficha fixa de produção */
(function(){
  const V52='5.2.0';

  // ----- Migração leve de produto -----
  DB.products.forEach(p=>{
    if(!Array.isArray(p.productionMaterials)) p.productionMaterials=[];
    if(p.mainInputId===undefined){ p.mainInputId=p.recipe?.[0]?.inputId||''; p.mainInputQty=n(p.recipe?.[0]?.qty)||1; }
    if(p.laborUnit===undefined) p.laborUnit=0;
    if(p.setupLabor===undefined) p.setupLabor=0;
  });
  DB.meta={...(DB.meta||{}),version:V52}; saveDB();

  // ----- helpers da composição -----
  function mainMaterialCost(p){
    const i=inputById(p?.mainInputId); return i?n(i.referenceCost)*Math.max(0,n(p.mainInputQty)||1):0;
  }
  function fixedMaterialUnit(m){
    if(n(m.unitCostFixed)>0) return n(m.unitCostFixed);
    const y=Math.max(1,n(m.yieldQty)||1), use=Math.max(0,n(m.usageQty)||1);
    return n(m.purchasePrice)/y*use;
  }
  function additionalMaterialsCost(p){return (p?.productionMaterials||[]).reduce((s,m)=>s+fixedMaterialUnit(m),0);}
  function legacyAdditionalCost(p){return n(p?.packaging)+n(p?.extraMaterial)+n(p?.thirdParty);}
  function productLaborUnit(p){
    if(n(p?.laborUnit)>0)return n(p.laborUnit);
    return n(p?.productionMinutes)/60*hourValue();
  }
  function setupOrderCost(p){
    if(n(p?.setupLabor)>0)return n(p.setupLabor);
    return n(p?.setupMinutes)/60*hourValue();
  }
  window.mainMaterialCost=mainMaterialCost; window.additionalMaterialsCost=additionalMaterialsCost;

  // ----- cálculo transparente: taxa entra uma vez no pedido -----
  calculatePrice=function(opt={}){
    const product=productById(opt.productId), qty=Math.max(1,Math.floor(n(opt.qty)||1));
    const payment=paymentById(opt.paymentId||DB.config.defaultPayment);
    const waste=n(opt.wastePct??product?.wastePct??DB.config.wastePct)/100;
    const reserve=n(opt.reservePct??DB.config.reservePct)/100;
    const margin=n(opt.marginPct??DB.config.targetMarginRetail)/100;
    const tax=n(opt.taxPct??DB.config.taxPct)/100;
    const discount=n(opt.discountPct||0)/100;
    const mainUnit=product?mainMaterialCost(product):n(opt.manualDirect);
    const inputsAdditionalUnit=product?additionalMaterialsCost(product):0;
    const legacyUnit=product?legacyAdditionalCost(product):0;
    const materialUnit=mainUnit+inputsAdditionalUnit+legacyUnit;
    const wasteUnit=materialUnit*waste;
    const laborUnit=product?productLaborUnit(product):n(opt.laborUnit);
    const setupOrder=product?setupOrderCost(product):n(opt.setupLabor);
    const setupUnit=setupOrder/qty;
    const indUnit=n(opt.indirectUnit??indirectUnit());
    const rawUnit=materialUnit+wasteUnit+laborUnit+setupUnit+indUnit;
    const reserveUnit=rawUnit*reserve;
    const protectedUnit=rawUnit+reserveUnit;
    const protectedOrder=protectedUnit*qty;
    const feePct=n(payment.pct)/100, fixed=n(payment.fixed);
    const denomMin=1-feePct-tax, denomTarget=1-feePct-tax-margin;
    if(denomMin<=0||denomTarget<=0)return {error:'A soma de taxas, impostos e margem é alta demais para formar um preço válido.'};
    const minimumOrder=(protectedOrder+fixed)/denomMin;
    const targetChargedOrder=(protectedOrder+fixed)/denomTarget;
    const listOrder=discount<1?targetChargedOrder/(1-discount):targetChargedOrder;
    const minimumUnit=minimumOrder/qty, targetUnit=listOrder/qty;
    const suggestedUnit=roundCommercial(targetUnit), listSuggestedOrder=suggestedUnit*qty;
    const chargedOrder=listSuggestedOrder*(1-discount);
    const fees=chargedOrder*feePct+fixed, taxes=chargedOrder*tax;
    const profit=chargedOrder-fees-taxes-protectedOrder, profitUnit=profit/qty;
    const effectiveMargin=chargedOrder?profit/chargedOrder*100:0;
    return {product,qty,payment,mainUnit,inputsAdditionalUnit,legacyUnit,materialUnit,wasteUnit,laborUnit,setupOrder,setupUnit,indUnit,rawUnit,reserveUnit,protectedUnit,protectedOrder,minimumOrder,minimumUnit,targetChargedOrder,listOrder,targetUnit,suggestedUnit,listSuggestedOrder,chargedOrder,fees,taxes,profit,profitUnit,effectiveMargin,discount:discount*100,margin:margin*100,waste:waste*100,reserve:reserve*100};
  };

  // ----- ficha de produto: principal + composição padrão + mão de obra -----
  function materialRow(m={},idx=0){return `<div class="material-row form-grid" data-i="${idx}">
    <label class="field span-4"><span class="label">Material</span><input class="pm-name" value="${esc(m.name||'')}" placeholder="Ex.: folha sublimática"></label>
    <label class="field span-2"><span class="label">Preço compra</span><input class="pm-price" inputmode="decimal" value="${n(m.purchasePrice)||''}" placeholder="R$"></label>
    <label class="field span-2"><span class="label">Rende</span><input class="pm-yield" inputmode="decimal" value="${n(m.yieldQty)||1}" placeholder="peças"></label>
    <label class="field span-2"><span class="label">Uso/peça</span><input class="pm-use" inputmode="decimal" value="${n(m.usageQty)||1}"></label>
    <div class="field span-1"><span class="label">Custo/un.</span><div class="readonly-cost">${money(fixedMaterialUnit(m))}</div></div>
    <div class="span-1 row-delete"><button type="button" class="btn small danger" onclick="this.closest('.material-row').remove();refreshMaterialPreview()">×</button></div>
  </div>`;}
  window.addProductionMaterial=()=>{const c=q('#productionMaterials');c.insertAdjacentHTML('beforeend',materialRow({},c.children.length));bindMaterialRows(c);};
  function bindMaterialRows(root=document){root.querySelectorAll('.material-row input').forEach(el=>{if(el.dataset.matbound)return;el.dataset.matbound='1';el.addEventListener('input',refreshMaterialPreview);});}
  window.refreshMaterialPreview=()=>{document.querySelectorAll('.material-row').forEach(r=>{const price=n(r.querySelector('.pm-price')?.value),yieldQty=Math.max(1,n(r.querySelector('.pm-yield')?.value)||1),use=Math.max(0,n(r.querySelector('.pm-use')?.value)||1),out=r.querySelector('.readonly-cost');if(out)out.textContent=money(price/yieldQty*use);});const total=[...document.querySelectorAll('.material-row')].reduce((s,r)=>s+n(r.querySelector('.pm-price')?.value)/Math.max(1,n(r.querySelector('.pm-yield')?.value)||1)*Math.max(0,n(r.querySelector('.pm-use')?.value)||1),0);const el=q('#additionalTotal');if(el)el.textContent=money(total);};

  productModal=function(p={}){
    const mats=p.productionMaterials||[];
    const body=`<div class="form-grid">
      <label class="field span-6"><span class="label">Nome do produto</span><input id="prdName" value="${esc(p.name||'')}"></label>
      ${pickerHTML({id:'prdCatId',label:'Categoria',items:DB.categories,selectedId:p.categoryId||'',placeholder:'Busque a categoria',span:'span-3'})}
      <label class="field span-3"><span class="label">SKU</span><input id="prdSku" value="${esc(p.sku||'')}"></label>
      <div class="span-12 section-title"><h3>1. Material principal</h3><p>Varia conforme sua base de compra. O custo vem do cadastro do insumo.</p></div>
      ${pickerHTML({id:'prdMainInput',label:'Material principal',items:DB.inputs,selectedId:p.mainInputId||'',placeholder:'Busque o material principal',span:'span-8',help:'Ex.: caneca branca 325 ml, ecobag crua, camisa.'})}
      <label class="field span-4"><span class="label">Quantidade usada por peça</span><input id="prdMainQty" value="${n(p.mainInputQty)||1}"></label>
      <div class="span-12 section-title"><h3>2. Composição padrão de produção</h3><p>Cadastre uma vez os materiais recorrentes. O sistema soma automaticamente em <b>Insumos adicionais</b>.</p></div>
      <div class="span-12" id="productionMaterials">${mats.length?mats.map(materialRow).join(''):materialRow({},0)}</div>
      <div class="span-12 material-total"><span>Insumos adicionais calculados</span><strong id="additionalTotal">${money(additionalMaterialsCost(p))}</strong><button class="btn small outline" type="button" onclick="addProductionMaterial()">+ Adicionar material</button></div>
      <div class="span-12 section-title"><h3>3. Mão de obra padrão</h3><p>Valores definidos uma vez para este produto e reutilizados em cada precificação.</p></div>
      <label class="field span-4"><span class="label">Mão de obra por unidade (R$)</span><input id="prdLabor" value="${n(p.laborUnit)||''}"><small>Se ficar vazio, o sistema pode usar tempo × valor/hora.</small></label>
      <label class="field span-4"><span class="label">Preparação fixa por pedido (R$)</span><input id="prdSetupLabor" value="${n(p.setupLabor)||''}"><small>Arte, ajuste, preparação da máquina etc. Dilui no atacado.</small></label>
      <label class="field span-2"><span class="label">Tempo/un. (min)</span><input id="prdMin" value="${n(p.productionMinutes)}"></label>
      <label class="field span-2"><span class="label">Preparo (min)</span><input id="prdSetup" value="${n(p.setupMinutes)}"></label>
      <label class="field span-3"><span class="label">Perda específica (%)</span><input id="prdWaste" placeholder="Padrão ${DB.config.wastePct}%" value="${p.wastePct??''}"></label>
      <label class="field span-3"><span class="label">Preço atual</span><input id="prdPrice" value="${n(p.salePrice)||''}"></label>
      <label class="field span-3"><span class="label">Preço mínimo definido</span><input id="prdMinPrice" value="${n(p.minimumPrice)||''}"></label>
      <label class="field span-3"><span class="label">Disponibilidade</span><select id="prdAvail"><option value="sob_encomenda" ${p.availability!=='pronta_entrega'?'selected':''}>Sob encomenda</option><option value="pronta_entrega" ${p.availability==='pronta_entrega'?'selected':''}>Pronta entrega</option></select></label>
      <label class="field span-3"><span class="label">Publicado</span><select id="prdPub"><option value="1" ${p.published!==false?'selected':''}>Sim</option><option value="0" ${p.published===false?'selected':''}>Não</option></select></label>
      <label class="field span-9"><span class="label">Descrição</span><input id="prdDesc" value="${esc(p.description||'')}"></label>
      <label class="field span-12"><span class="label">Observações</span><textarea id="prdNote">${esc(p.note||'')}</textarea></label>
    </div>`;
    openModal(modalShell(p.id?'Editar produto':'Novo produto',body,`<button class="btn outline" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="saveProductV52('${p.id||''}')">Salvar produto</button>`));
    setTimeout(()=>{bindSearchPickers(q('#modal'));bindMaterialRows(q('#modal'));refreshMaterialPreview();},0);
  };
  window.saveProductV52=id=>{
    const name=q('#prdName').value.trim();if(!name)return toast('Informe o nome do produto.');
    const old=productById(id), materials=[...document.querySelectorAll('.material-row')].map(r=>({name:r.querySelector('.pm-name').value.trim(),purchasePrice:n(r.querySelector('.pm-price').value),yieldQty:Math.max(1,n(r.querySelector('.pm-yield').value)||1),usageQty:Math.max(0,n(r.querySelector('.pm-use').value)||1)})).filter(m=>m.name&&m.purchasePrice>0);
    const mainInputId=q('#prdMainInput').value;
    const obj={...old,id:id||uid('prd'),name,categoryId:q('#prdCatId').value,category:catName(q('#prdCatId').value)==='Sem categoria'?'':catName(q('#prdCatId').value),sku:q('#prdSku').value.trim(),mainInputId,mainInputQty:n(q('#prdMainQty').value)||1,productionMaterials:materials,laborUnit:n(q('#prdLabor').value),setupLabor:n(q('#prdSetupLabor').value),productionMinutes:n(q('#prdMin').value),setupMinutes:n(q('#prdSetup').value),wastePct:q('#prdWaste').value===''?null:n(q('#prdWaste').value),salePrice:n(q('#prdPrice').value),minimumPrice:n(q('#prdMinPrice').value),availability:q('#prdAvail').value,published:q('#prdPub').value==='1',description:q('#prdDesc').value.trim(),note:q('#prdNote').value.trim(),recipe:mainInputId?[{inputId:mainInputId,qty:n(q('#prdMainQty').value)||1}]:[],packaging:0,extraMaterial:0,thirdParty:0,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
    if(id)DB.products[DB.products.findIndex(x=>x.id===id)]=obj;else DB.products.push(obj);saveDB();closeModal();render();toast('Produto e ficha de produção salvos.');
  };

  // ----- precificação em uma tela -----
  pricingTabs=function(){return `<div class="tabs"><button class="tab-btn ${state.tab==='calculator'?'active':''}" data-tab="calculator">Precificar</button><button class="tab-btn ${state.tab==='radar'?'active':''}" data-tab="radar">Radar</button><button class="tab-btn ${state.tab==='priceCatalog'?'active':''}" data-tab="priceCatalog">Histórico de preços</button></div>`;};
  pricingFormValues=function(){const p=state.pricing||{};return {productId:p.productId||DB.products[0]?.id||'',qty:p.qty||1,paymentId:p.paymentId||DB.config.defaultPayment,marginPct:p.marginPct??DB.config.targetMarginRetail,reservePct:p.reservePct??DB.config.reservePct,wastePct:p.wastePct??DB.config.wastePct,taxPct:p.taxPct??DB.config.taxPct,discountPct:p.discountPct||0};};
  window.pricingProductPicked=id=>{state.pricing={...(state.pricing||{}),productId:id,result:null};render();};
  function productCompositionCard(p){if(!p)return `<div class="notice">Selecione um produto para ver a composição.</div>`;const main=mainMaterialCost(p),add=additionalMaterialsCost(p),legacy=legacyAdditionalCost(p),labor=productLaborUnit(p);return `<div class="composition-card"><div class="composition-head"><div><b>${esc(p.name)}</b><small>Custos pré-fixados desta ficha</small></div><button class="btn small outline" onclick="editProduct('${p.id}')">Editar ficha</button></div><div class="composition-grid"><div><span>Material principal</span><strong>${money(main)}</strong></div><div><span>Insumos adicionais</span><strong>${money(add)}</strong></div><div><span>Mão de obra/un.</span><strong>${money(labor)}</strong></div><div><span>Preparação/pedido</span><strong>${money(setupOrderCost(p))}</strong></div>${legacy>0?`<div><span>Custos antigos migrados</span><strong>${money(legacy)}</strong></div>`:''}</div>${(p.productionMaterials||[]).length?`<details><summary>Ver materiais adicionais</summary>${p.productionMaterials.map(m=>`<div class="mini-line"><span>${esc(m.name)}</span><b>${money(fixedMaterialUnit(m))}</b></div>`).join('')}</details>`:''}</div>`;}
  calcForm=function(){const x=pricingFormValues(),p=productById(x.productId),pay=paymentById(x.paymentId);return `<div class="card pricing-main-card"><h2>Precificar pedido</h2><p class="muted">Escolha o produto, informe a quantidade e a forma de pagamento. Os custos fixos da ficha entram automaticamente.</p><div class="form-grid">
    ${pickerHTML({id:'pcProduct',label:'Produto',items:DB.products,selectedId:x.productId,placeholder:'Digite para buscar o produto',span:'span-6',onpick:'pricingProductPicked'})}
    <label class="field span-2"><span class="label">Quantidade</span><input id="pcQty" inputmode="numeric" value="${x.qty}"></label>
    ${pickerHTML({id:'pcPayment',label:'Pagamento',items:DB.payments.filter(p=>p.active),selectedId:x.paymentId,placeholder:'Digite a forma de pagamento',span:'span-4'})}
  </div>${productCompositionCard(p)}<div class="fee-once"><span>Taxa desta forma de pagamento</span><b>${n(pay.pct)?pct(pay.pct):'0%'}${n(pay.fixed)?` + ${money(pay.fixed)} fixos`:''}</b><small>A tarifa fixa é aplicada <b>uma única vez no pedido</b>.</small></div><details class="advanced-box"><summary>Ajustes da precificação</summary><div class="form-grid" style="margin-top:12px"><label class="field span-3"><span class="label">Margem desejada (%)</span><input id="pcMargin" value="${x.marginPct}"></label><label class="field span-3"><span class="label">Reserva PAfro (%)</span><input id="pcReserve" value="${x.reservePct}"></label><label class="field span-2"><span class="label">Perda (%)</span><input id="pcWaste" value="${x.wastePct}"></label><label class="field span-2"><span class="label">Impostos (%)</span><input id="pcTax" value="${x.taxPct}"></label><label class="field span-2"><span class="label">Desconto (%)</span><input id="pcDiscount" value="${x.discountPct}"></label></div></details><div class="form-actions"><button class="btn primary" onclick="runPricingV52()">Calcular preço</button></div></div>`;};
  function readV52(){const old=state.pricing||{};return {productId:q('#pcProduct')?.value||old.productId||'',qty:n(q('#pcQty')?.value)||1,paymentId:q('#pcPayment')?.value||old.paymentId||DB.config.defaultPayment,marginPct:q('#pcMargin')?n(q('#pcMargin').value):(old.marginPct??DB.config.targetMarginRetail),reservePct:q('#pcReserve')?n(q('#pcReserve').value):(old.reservePct??DB.config.reservePct),wastePct:q('#pcWaste')?n(q('#pcWaste').value):(old.wastePct??DB.config.wastePct),taxPct:q('#pcTax')?n(q('#pcTax').value):(old.taxPct??DB.config.taxPct),discountPct:q('#pcDiscount')?n(q('#pcDiscount').value):(old.discountPct||0)};}
  window.runPricingV52=()=>{const opt=readV52();if(!opt.productId)return toast('Selecione um produto.');const result=calculatePrice(opt);if(result.error)return toast(result.error);state.pricing={...opt,result};render();};

  function summaryCard(r){return `<div class="card pricing-summary"><h2>Resumo da precificação</h2><div class="summary-price"><small>Preço sugerido por unidade</small><strong>${money(r.suggestedUnit)}</strong><span>${r.qty} un. = ${money(r.listSuggestedOrder)}</span></div><div class="break-row"><span>Material principal</span><b>${money(r.mainUnit)}</b></div><div class="break-row"><span>Insumos adicionais</span><b>${money(r.inputsAdditionalUnit+r.legacyUnit)}</b></div><div class="break-row"><span>Mão de obra/un.</span><b>${money(r.laborUnit)}</b></div><div class="break-row"><span>Preparação diluída/un.</span><b>${money(r.setupUnit)}</b></div><div class="break-row"><span>Perdas/un.</span><b>${money(r.wasteUnit)}</b></div><div class="break-row"><span>Custos indiretos/un.</span><b>${money(r.indUnit)}</b></div><div class="break-row total"><span>Custo real/un.</span><b>${money(r.rawUnit)}</b></div><div class="break-row"><span>Reserva PAfro/un.</span><b>${money(r.reserveUnit)}</b></div><div class="break-row"><span>Taxa total do pedido</span><b>${money(r.fees)}</b></div><div class="break-row"><span>Lucro total estimado</span><b>${money(r.profit)}</b></div><div class="break-row"><span>Margem efetiva</span><b>${pct(r.effectiveMargin)}</b></div><div class="notice blue" style="margin-top:12px"><b>Preço mínimo seguro:</b> ${money(r.minimumUnit)} por unidade.</div></div>`;}
  function wholesaleMargins(){const retail=n(DB.config.targetMarginRetail),floor=Math.min(retail,n(DB.config.targetMarginWholesale));return [{q:1,m:retail,label:'Varejo'}, {q:20,m:floor+(retail-floor)*.75,label:'Atacado inicial'}, {q:30,m:floor+(retail-floor)*.5,label:'Atacado'}, {q:50,m:floor+(retail-floor)*.25,label:'Atacado volume'}, {q:100,m:floor,label:'Atacado +100'}];}
  function healthLabel(m,floor){if(m>=floor+5)return '<span class="pill good">Saudável</span>';if(m>=floor)return '<span class="pill blue">Atacado competitivo</span>';if(m>=Math.max(0,floor-3))return '<span class="pill warn">Atenção</span>';return '<span class="pill bad">Não recomendado</span>';}
  function wholesaleTable(opt){const floor=n(DB.config.targetMarginWholesale),rows=wholesaleMargins().map(t=>{const r=calculatePrice({...opt,qty:t.q,marginPct:t.m});return `<tr><td><b>${t.q===100?'100+':t.q}</b><div class="tiny muted">${t.label}</div></td><td class="money strong">${money(r.suggestedUnit)}</td><td class="money">${money(r.listSuggestedOrder)}</td><td class="money">${money(r.profitUnit)}</td><td class="money">${money(r.profit)}</td><td class="money">${pct(r.effectiveMargin)}</td><td>${healthLabel(r.effectiveMargin,floor)}</td></tr>`;}).join('');return `<div class="card wholesale-card"><div class="wholesale-head"><div><h2>Tabela de atacado sugerida</h2><p class="muted">Quanto maior o pedido, mais custos fixos são diluídos. A margem por unidade pode cair sem sacrificar o lucro total.</p></div><div class="pill blue">Margem mínima atacado: ${pct(floor)}</div></div><div class="table-wrap"><table class="table"><thead><tr><th>Faixa</th><th class="money">Preço/un.</th><th class="money">Total pedido</th><th class="money">Lucro/un.</th><th class="money">Lucro total</th><th class="money">Margem</th><th>Leitura</th></tr></thead><tbody>${rows}</tbody></table></div><div class="notice"><b>Conceito de atacado:</b> menor ganho unitário + maior volume + diluição de custos fixos + proteção do lucro total. Os valores são sugestões calculadas, não descontos cegos sobre o varejo.</div></div>`;}
  renderCalculator=function(){const r=state.pricing?.result,opt=state.pricing||pricingFormValues();return `<div class="pricing-layout"><div>${calcForm()}</div><div>${r?summaryCard(r):`<div class="card pricing-summary"><h2>Resumo</h2><div class="empty">O custo do material, insumos e mão de obra aparecerão aqui junto com o resultado. Nada precisa ser lembrado de outra tela.</div></div>`}</div></div>${r?wholesaleTable(opt):''}`;};
  renderPricing=function(){let body='';if(state.tab==='radar')body=renderRadar();else if(state.tab==='priceCatalog')body=renderPriceCatalog();else {state.tab='calculator';body=renderCalculator();}return `${pageHead('Precificação','Uma tela para enxergar custo, taxa, lucro e atacado sem duplicidade.',`<button class="btn outline" onclick="showPricingGuide()">? Como funciona</button>`)}${pricingTabs()}${body}`;};

  // Ajusta cards de produtos para mostrar o custo que realmente importa.
  renderProducts=function(){const list=DB.products;return `${pageHead('Produtos','Ficha de produção: material principal, insumos adicionais e mão de obra.',`<button class="btn yellow" onclick="newProduct()">+ Novo produto</button>`)}<div class="catalog-grid">${list.length?list.map(p=>{const base=mainMaterialCost(p),add=additionalMaterialsCost(p),lab=productLaborUnit(p);return `<div class="product-card"><div class="product-icon">💡</div><h3>${esc(p.name)}</h3><p>${esc(p.category||'Sem categoria')}</p><div class="price">${p.salePrice?money(p.salePrice):'Sem preço definido'}</div><div class="mini-line"><span>Material principal</span><b>${money(base)}</b></div><div class="mini-line"><span>Insumos adicionais</span><b>${money(add)}</b></div><div class="mini-line"><span>Mão de obra</span><b>${money(lab)}</b></div><div class="form-actions"><button class="btn small blue" onclick="editProduct('${p.id}')">Editar ficha</button><button class="btn small outline" onclick="priceProductFromCatalog('${p.id}')">Precificar</button><button class="btn small danger" onclick="deleteProduct('${p.id}')">Excluir</button></div></div>`;}).join(''):`<div class="card"><div class="empty">Nenhum produto cadastrado.</div></div>`}</div>`;};

  // produto selecionado a partir do catálogo
  window.priceProductFromCatalog=id=>{state.view='pricing';state.tab='calculator';state.pricing={productId:id,qty:1,paymentId:DB.config.defaultPayment,marginPct:DB.config.targetMarginRetail,reservePct:DB.config.reservePct,wastePct:DB.config.wastePct,taxPct:DB.config.taxPct,discountPct:0,result:null};render();};

  // garante binds novos
  const prevBind=bindView; bindView=function(){prevBind();bindMaterialRows();};
  render();
})();
