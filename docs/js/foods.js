/* Quick-add library, the Singapore reference table the estimator is anchored on,
   default products, and the shake calculator. Pure functions — no DOM, no DB. */

// ---- quick add: the fixed set, one tap
export const QUICK = [
  { id: "kaya_set",     label: "Kaya toast set",            sub: "2 half-boiled eggs, kaya butter toast, kopi o peng", kcal: 500, lo: 450, hi: 560, protein: 19 },
  { id: "eggs4_bread2", label: "4 half-boiled eggs + 2 bread", sub: "white pepper, soy sauce",                       kcal: 460, lo: 410, hi: 520, protein: 30 },
  { id: "omelette3",    label: "3-egg omelette + 2 bread",  sub: "with chilli sauce",                                kcal: 460, lo: 400, hi: 520, protein: 26 },
  { id: "omelette4",    label: "4-egg omelette + 4 bread",  sub: "with chilli sauce",                                kcal: 700, lo: 620, hi: 800, protein: 38 },
  { id: "tuna_cheese",  label: "Tuna + 2 cheese + 4 bread", sub: "one can, drained",                                 kcal: 640, lo: 560, hi: 720, protein: 46 },
  { id: "cr925_reg",    label: "925 chicken rice ($5)",     sub: "roasted, regular",                                 kcal: 650, lo: 550, hi: 750, protein: 32 },
  { id: "cr925_extra",  label: "925 chicken rice ($8)",     sub: "extra chicken",                                    kcal: 850, lo: 720, hi: 980, protein: 48 },
  { id: "yakult",       label: "Yakult",                    sub: "1 bottle",                                         kcal: 50,  lo: 45,  hi: 55,  protein: 0.8 },
  { id: "yakult2",      label: "Yakult ×2",                 sub: "",                                                 kcal: 100, lo: 90,  hi: 110, protein: 1.6 },
  { id: "kopi_o_peng",  label: "Kopi o peng",               sub: "",                                                 kcal: 80,  lo: 60,  hi: 100, protein: 0 },
  { id: "teh_peng",     label: "Teh peng",                  sub: "",                                                 kcal: 130, lo: 100, hi: 160, protein: 3 },
  { id: "teh_o_peng",   label: "Teh o peng",                sub: "",                                                 kcal: 60,  lo: 40,  hi: 80,  protein: 0 },
  { id: "americano",    label: "Americano",                 sub: "Luckin, black",                                    kcal: 5,   lo: 0,   hi: 10,  protein: 0 },
  { id: "coconut",      label: "Coconut water",             sub: "bottle",                                           kcal: 60,  lo: 45,  hi: 80,  protein: 0 },
  { id: "coke",         label: "Coke 500ml",                sub: "regular",                                          kcal: 210, lo: 200, hi: 220, protein: 0 },
  { id: "greek125",     label: "Greek yogurt 125g",         sub: "Farmers Union high-protein",                       kcal: 70,  lo: 60,  hi: 80,  protein: 10 },
  { id: "mcd_dcb",      label: "Double cheeseburger",       sub: "McDonald's SG",                                    kcal: 440, lo: 420, hi: 470, protein: 25 },
  { id: "mcd_smm",      label: "Sausage McMuffin",          sub: "",                                                 kcal: 300, lo: 280, hi: 320, protein: 13 },
  { id: "mcd_smm_egg",  label: "Sausage McMuffin with egg", sub: "",                                                 kcal: 380, lo: 360, hi: 400, protein: 19 },
  { id: "mcd_cmm",      label: "Chicken McMuffin",          sub: "",                                                 kcal: 320, lo: 300, hi: 340, protein: 15 },
  { id: "mcd_bigbrk",   label: "Big Breakfast",             sub: "McDonald's SG",                                    kcal: 550, lo: 500, hi: 600, protein: 25 },
  { id: "csp_pau",      label: "Char siew pau",             sub: "1 piece",                                          kcal: 220, lo: 190, hi: 250, protein: 7 },
  { id: "tuna_bread",   label: "Cheesy tuna bread",         sub: "bakery",                                           kcal: 320, lo: 280, hi: 380, protein: 12 },
];
export const QUICK_BY_ID = Object.fromEntries(QUICK.map(q => [q.id, q]));

// ---- reference table: what the model identifies against; the app does the arithmetic.
// One row = one standard portion. Values are typical Singapore hawker servings,
// in the same range as HPB's published figures. Refine any row from a better source.
export const REFERENCE = [
  // rice plates
  { id: "chicken_rice",        name: "Hainanese chicken rice, regular plate",          portion: "1 plate",    kcal: 650, lo: 600, hi: 700, protein: 32 },
  { id: "chicken_rice_extra",  name: "Chicken rice with extra chicken",                portion: "1 plate",    kcal: 870, lo: 800, hi: 950, protein: 50 },
  { id: "roast_meat_rice",     name: "Roast pork / char siew rice",                    portion: "1 plate",    kcal: 700, lo: 620, hi: 780, protein: 30 },
  { id: "duck_rice",           name: "Roast duck rice",                                portion: "1 plate",    kcal: 700, lo: 620, hi: 780, protein: 30 },
  { id: "nasi_lemak",          name: "Nasi lemak with fried chicken wing and egg",     portion: "1 plate",    kcal: 650, lo: 600, hi: 700, protein: 25 },
  { id: "ayam_penyet",         name: "Ayam penyet with rice",                          portion: "1 plate",    kcal: 800, lo: 750, hi: 850, protein: 40 },
  { id: "nasi_padang",         name: "Nasi padang, rice + 1 meat + 2 veg",             portion: "1 plate",    kcal: 720, lo: 650, hi: 800, protein: 30 },
  { id: "economy_rice",        name: "Economy rice, rice + 1 meat + 2 veg",            portion: "1 plate",    kcal: 620, lo: 550, hi: 700, protein: 25 },
  { id: "chicken_cutlet_rice", name: "Chicken cutlet rice (western stall)",            portion: "1 plate",    kcal: 800, lo: 750, hi: 850, protein: 38 },
  { id: "fried_rice",          name: "Fried rice (hawker)",                            portion: "1 plate",    kcal: 650, lo: 580, hi: 720, protein: 18 },
  { id: "thai_basil_rice",     name: "Thai basil minced meat rice with egg",           portion: "1 plate",    kcal: 700, lo: 630, hi: 780, protein: 30 },
  { id: "curry_rice",          name: "Hainanese curry rice (rice, cutlet, egg, curry)",portion: "1 plate",    kcal: 800, lo: 720, hi: 900, protein: 28 },
  // noodles
  { id: "char_kway_teow",      name: "Char kway teow",                                 portion: "1 plate",    kcal: 740, lo: 700, hi: 780, protein: 22 },
  { id: "hokkien_mee",         name: "Hokkien mee",                                    portion: "1 plate",    kcal: 620, lo: 600, hi: 650, protein: 27 },
  { id: "laksa",               name: "Laksa",                                          portion: "1 bowl",     kcal: 590, lo: 550, hi: 620, protein: 22 },
  { id: "mee_siam",            name: "Mee siam",                                       portion: "1 plate",    kcal: 530, lo: 500, hi: 560, protein: 17 },
  { id: "mee_rebus",           name: "Mee rebus",                                      portion: "1 plate",    kcal: 570, lo: 550, hi: 600, protein: 20 },
  { id: "mee_goreng",          name: "Mee goreng",                                     portion: "1 plate",    kcal: 660, lo: 600, hi: 720, protein: 18 },
  { id: "wanton_mee_dry",      name: "Wanton mee, dry",                                portion: "1 plate",    kcal: 420, lo: 400, hi: 450, protein: 20 },
  { id: "lor_mee",             name: "Lor mee",                                        portion: "1 bowl",     kcal: 580, lo: 550, hi: 620, protein: 20 },
  { id: "bak_chor_mee",        name: "Bak chor mee, dry",                              portion: "1 bowl",     kcal: 530, lo: 500, hi: 560, protein: 24 },
  { id: "fishball_noodle",     name: "Fishball noodle soup",                           portion: "1 bowl",     kcal: 380, lo: 350, hi: 400, protein: 20 },
  { id: "prawn_mee_soup",      name: "Prawn mee soup",                                 portion: "1 bowl",     kcal: 320, lo: 300, hi: 350, protein: 22 },
  { id: "ban_mian",            name: "Ban mian soup",                                  portion: "1 bowl",     kcal: 480, lo: 440, hi: 520, protein: 22 },
  { id: "instant_noodle",      name: "Instant noodle, 1 packet, cooked",               portion: "1 packet",   kcal: 380, lo: 350, hi: 420, protein: 8 },
  // soups / others
  { id: "bak_kut_teh",         name: "Bak kut teh soup with ribs (no rice)",           portion: "1 bowl",     kcal: 320, lo: 300, hi: 350, protein: 28 },
  { id: "you_tiao",            name: "You tiao",                                       portion: "1 piece",    kcal: 120, lo: 100, hi: 140, protein: 3 },
  { id: "white_rice",          name: "White rice",                                     portion: "1 bowl ~200 g", kcal: 260, lo: 240, hi: 280, protein: 5 },
  { id: "porridge",            name: "Plain rice porridge",                            portion: "1 bowl",     kcal: 180, lo: 150, hi: 220, protein: 4 },
  { id: "yong_tau_foo",        name: "Yong tau foo, 6 pieces, soup, no noodles",       portion: "1 bowl",     kcal: 300, lo: 250, hi: 350, protein: 22 },
  { id: "mala_xiang_guo",      name: "Mala xiang guo (dry), individual portion",       portion: "1 portion",  kcal: 900, lo: 700, hi: 1100, protein: 35 },
  { id: "roti_prata",          name: "Roti prata, plain",                              portion: "1 piece",    kcal: 215, lo: 200, hi: 230, protein: 5 },
  { id: "thosai",              name: "Thosai, plain",                                  portion: "1 piece",    kcal: 135, lo: 120, hi: 150, protein: 3 },
  { id: "curry_puff",          name: "Curry puff (Old Chang Kee style)",               portion: "1 piece",    kcal: 225, lo: 200, hi: 250, protein: 4 },
  { id: "char_siew_pau",       name: "Char siew pau",                                  portion: "1 piece",    kcal: 220, lo: 190, hi: 250, protein: 7 },
  { id: "chwee_kueh",          name: "Chwee kueh",                                     portion: "1 piece",    kcal: 60,  lo: 50,  hi: 70,  protein: 1 },
  { id: "carrot_cake_black",   name: "Fried carrot cake, black",                       portion: "1 plate",    kcal: 480, lo: 450, hi: 500, protein: 11 },
  // proteins by piece
  { id: "bbq_chicken_wing",    name: "BBQ chicken wing (hawker)",                      portion: "1 wing",     kcal: 150, lo: 130, hi: 170, protein: 10 },
  { id: "fried_chicken_wing",  name: "Fried chicken wing",                             portion: "1 wing",     kcal: 160, lo: 140, hi: 190, protein: 10 },
  { id: "satay",               name: "Satay stick with sauce",                         portion: "1 stick",    kcal: 52,  lo: 45,  hi: 60,  protein: 4.5 },
  { id: "chicken_breast_100",  name: "Chicken breast, cooked",                         portion: "100 g",      kcal: 165, lo: 155, hi: 175, protein: 31 },
  { id: "chicken_thigh_100",   name: "Chicken thigh with skin, cooked",                portion: "100 g",      kcal: 230, lo: 210, hi: 250, protein: 25 },
  { id: "roast_pork_100",      name: "Roast pork (sio bak)",                           portion: "100 g",      kcal: 330, lo: 300, hi: 380, protein: 22 },
  { id: "char_siew_100",       name: "Char siew",                                      portion: "100 g",      kcal: 260, lo: 230, hi: 300, protein: 22 },
  { id: "beef_100",            name: "Beef, cooked, lean",                             portion: "100 g",      kcal: 220, lo: 200, hi: 250, protein: 28 },
  { id: "fish_100",            name: "White fish, cooked",                             portion: "100 g",      kcal: 120, lo: 100, hi: 140, protein: 24 },
  { id: "prawn_100",           name: "Prawns, cooked",                                 portion: "100 g",      kcal: 100, lo: 90,  hi: 110, protein: 24 },
  { id: "luncheon_meat_slice", name: "Luncheon meat, fried slice",                     portion: "1 slice ~30 g", kcal: 95, lo: 85, hi: 110, protein: 4 },
  { id: "taiwan_sausage",      name: "Taiwanese sausage",                              portion: "1 piece",    kcal: 120, lo: 100, hi: 140, protein: 5 },
  { id: "egg",                 name: "Egg, whole (boiled or fried)",                   portion: "1 egg",      kcal: 75,  lo: 70,  hi: 90,  protein: 6 },
  { id: "tofu_puff",           name: "Tofu puff (tau pok)",                            portion: "1 piece",    kcal: 60,  lo: 50,  hi: 70,  protein: 4 },
  { id: "tempeh_100",          name: "Tempeh, fried",                                  portion: "100 g",      kcal: 210, lo: 190, hi: 230, protein: 15 },
  // bread and breakfast
  { id: "white_bread_slice",   name: "White bread",                                    portion: "1 slice",    kcal: 75,  lo: 70,  hi: 80,  protein: 2.5 },
  { id: "kaya_toast_set",      name: "Kaya butter toast set (2 slices, 2 eggs, kopi)", portion: "1 set",      kcal: 500, lo: 450, hi: 560, protein: 19 },
  { id: "french_toast_slice",  name: "French toast",                                   portion: "1 slice",    kcal: 150, lo: 130, hi: 170, protein: 5 },
  { id: "bacon_strip",         name: "Bacon",                                          portion: "1 strip",    kcal: 45,  lo: 40,  hi: 55,  protein: 3 },
  { id: "hash_brown",          name: "Hash brown (McDonald's)",                        portion: "1 piece",    kcal: 150, lo: 140, hi: 160, protein: 1.5 },
  // drinks
  { id: "kopi_o",              name: "Kopi o (black with sugar)",                      portion: "1 cup",      kcal: 80,  lo: 60,  hi: 100, protein: 0 },
  { id: "kopi",                name: "Kopi (with condensed milk)",                     portion: "1 cup",      kcal: 135, lo: 120, hi: 150, protein: 2.5 },
  { id: "teh",                 name: "Teh (with condensed milk)",                      portion: "1 cup",      kcal: 145, lo: 130, hi: 160, protein: 3 },
  { id: "teh_o",               name: "Teh o (black tea with sugar)",                   portion: "1 cup",      kcal: 60,  lo: 40,  hi: 80,  protein: 0 },
  { id: "milo_iced",           name: "Iced Milo",                                      portion: "1 cup",      kcal: 180, lo: 150, hi: 220, protein: 4 },
  { id: "coke_500",            name: "Coke, regular",                                  portion: "500 ml",     kcal: 210, lo: 200, hi: 220, protein: 0 },
  { id: "lime_juice",          name: "Lime juice (hawker)",                            portion: "1 cup",      kcal: 90,  lo: 70,  hi: 110, protein: 0 },
  { id: "coconut_water",       name: "Coconut water",                                  portion: "1 bottle",   kcal: 60,  lo: 45,  hi: 80,  protein: 0 },
  { id: "beer_pint",           name: "Beer, pint",                                     portion: "1 pint",     kcal: 220, lo: 200, hi: 250, protein: 2 },
  { id: "yakult",              name: "Yakult",                                         portion: "1 bottle",   kcal: 50,  lo: 45,  hi: 55,  protein: 0.8 },
  // fast food
  { id: "mcd_double_cheese",   name: "McDonald's SG double cheeseburger",              portion: "1",          kcal: 445, lo: 430, hi: 470, protein: 25 },
  { id: "mcd_dqp",             name: "McDonald's SG double quarter pounder",           portion: "1",          kcal: 770, lo: 740, hi: 800, protein: 45 },
  { id: "mcd_smm_egg",         name: "McDonald's SG sausage McMuffin with egg",        portion: "1",          kcal: 380, lo: 360, hi: 400, protein: 19 },
  { id: "mcd_fries_m",         name: "McDonald's medium fries",                        portion: "1",          kcal: 330, lo: 310, hi: 350, protein: 4 },
  { id: "mcd_fillet_o_fish",   name: "McDonald's Filet-O-Fish",                        portion: "1",          kcal: 390, lo: 370, hi: 410, protein: 16 },
];
export const REF_BY_ID = Object.fromEntries(REFERENCE.map(r => [r.id, r]));

// ---- products: milks per 100 ml, whey per gram of powder
export const DEFAULT_PRODUCTS = [
  { kind: "milk", label: "Meiji full cream", per: "100ml", kcal: 64, protein_g: 3.2, is_default: 1, active: 1 },
  { kind: "milk", label: "Meiji low fat",    per: "100ml", kcal: 47, protein_g: 3.4, is_default: 0, active: 1 },
  { kind: "milk", label: "Marigold HL",      per: "100ml", kcal: 51, protein_g: 3.6, is_default: 0, active: 1 },
  { kind: "milk", label: "Water",            per: "100ml", kcal: 0,  protein_g: 0,   is_default: 0, active: 1 },
  { kind: "whey", label: "Whey (set from your tub)", per: "g", kcal: 3.9, protein_g: 0.78, is_default: 1, active: 1 },
];

/** Deterministic. Same inputs, same answer, every time. */
export function shake(whey_g, milk_ml, whey, milk, creatine_g = 0) {
  const whey_p = whey_g * whey.protein_g, whey_k = whey_g * whey.kcal;
  const milk_p = milk_ml / 100 * milk.protein_g, milk_k = milk_ml / 100 * milk.kcal;
  const protein = whey_p + milk_p, kcal = whey_k + milk_k;
  let label = `Shake: ${whey_g}g ${whey.label}, ${milk_ml}ml ${milk.label}`;
  if (creatine_g) label += `, ${creatine_g}g creatine`;
  return {
    label, protein_g: Math.round(protein * 10) / 10,
    kcal: Math.round(kcal), kcal_lo: Math.round(kcal * 0.96), kcal_hi: Math.round(kcal * 1.04),
    breakdown: { whey_protein: Math.round(whey_p * 10) / 10, whey_kcal: Math.round(whey_k),
                 milk_protein: Math.round(milk_p * 10) / 10, milk_kcal: Math.round(milk_k) },
  };
}

/** Turn the model's identification into numbers. Reference rows win; model figures
    are used only for components it couldn't map, and those are flagged. */
export function computeFromIdentification(ident, share = 1) {
  const items = [];
  for (const c of ident.components || []) {
    const ref = c.ref ? REF_BY_ID[c.ref] : null;
    const qty = Number(c.quantity) > 0 ? Number(c.quantity) : 1;
    if (ref) {
      items.push({ name: c.name || ref.name, ref: ref.id, portion: `${qty}× ${ref.portion}`, quantity: qty,
        protein_g: ref.protein * qty, kcal: ref.kcal * qty, kcal_lo: ref.lo * qty, kcal_hi: ref.hi * qty,
        basis: "reference", confidence: c.confidence || "medium" });
    } else {
      const k = Number(c.kcal) || 0;
      items.push({ name: c.name, ref: null, portion: c.portion || "", quantity: qty,
        protein_g: Number(c.protein_g) || 0, kcal: k,
        kcal_lo: Number(c.kcal_lo) || Math.round(k * 0.8), kcal_hi: Number(c.kcal_hi) || Math.round(k * 1.2),
        basis: "model", confidence: c.confidence || "low" });
    }
  }
  const sum = (f) => items.reduce((a, i) => a + i[f], 0);
  const r = (x) => Math.round(x * share);
  const modelShare = items.length ? items.filter(i => i.basis === "model").reduce((a, i) => a + i.kcal, 0) / Math.max(1, sum("kcal")) : 0;
  return {
    dish: ident.dish || items.map(i => i.name).join(", "),
    items: items.map(i => ({ ...i, protein_g: Math.round(i.protein_g * share * 10) / 10, kcal: r(i.kcal), kcal_lo: r(i.kcal_lo), kcal_hi: r(i.kcal_hi) })),
    protein_g: Math.round(sum("protein_g") * share * 10) / 10,
    kcal: r(sum("kcal")), kcal_lo: r(sum("kcal_lo")), kcal_hi: r(sum("kcal_hi")),
    share, confidence: ident.confidence || (modelShare > 0.5 ? "low" : "medium"),
    assumptions: ident.assumptions || [], grounding: ident.grounding || [], tighten: ident.tighten || "",
    model_share: Math.round(modelShare * 100) / 100,
  };
}
