import { MonksEnhancedJournal, pricename } from "./monks-enhanced-journal.js";

export let getValue = (item, name, defvalue = 0) => {
    return MEJHelpers.getValue(item, name, defvalue);
}

export let setValue = (item, name, value = 1) => {
    return MEJHelpers.setValue(item, name, value);
}

export let getPrice = (item, name, ignorePrice = false) => {
    return MEJHelpers.getPrice(item, name, ignorePrice);
}

export let setPrice = (item, name, price) => {
    return MEJHelpers.setPrice(item, name, price);
}

export let createOwnedItem = (actor, itemData) => {
    return MEJHelpers.createOwnedItem(actor, itemData);
}

export class MEJHelpers {
    static getValue(item, name, defvalue = 0) {
        name = name || pricename();
        if (!item)
            return defvalue;
        let value = (item.system != undefined ? foundry.utils.getProperty(item?.system, name) : foundry.utils.getProperty(item, name));
        
        if (value && typeof value === 'object' && game.system.id == "pf2e") {
            value = Object.values(value)[0];
        } else {
            value = (value?.hasOwnProperty("value") ? value.value + (value.denomination ? " " + value.denomination : "") : value);
        }
        return value ?? defvalue;
    }

    static setValue(item, name, value = 1, options = {}) {
        let prop = (item.system != undefined ? item.system : item);
        let data = foundry.utils.getProperty(prop, name);
        foundry.utils.setProperty(prop, name, (data && data.hasOwnProperty("value") && !value.hasOwnProperty("value") && !options.overwrite ? Object.assign(data, { value: value }) : value));
    }

    static defaultCurrency() {
        let currency = MonksEnhancedJournal.currencies.find(c => c.convert == 0);
        return currency?.id || "";
    }

    static getSystemPrice(item, name, ignorePrice = false) {
        name = name || pricename();

        let cost = 0;
        if (typeof item == "string")
            cost = item;
        else if (item.system?.denomination != undefined && name != "cost") {
            cost = item.system?.value.value + " " + item.system?.denomination.value;
        } else if (game.system.id === "rmss") {
            // rmss stores the numeric amount (unitCost/cost) and its denomination
            // (system.currency_type) as two separate fields, unlike the generic "13 gp"
            // string this helper otherwise expects - combine them, or getPrice() below has no
            // unit to read and silently defaults to gold (convert:0/reference), which is how
            // "13 tin" was turning into "13 gold" when an item got added to a shop.
            let value = getValue(item, name, null);
            cost = (value != null && value !== "") ? `${value} ${item.system?.currency_type || "gold"}` : value;
        } else {
            cost = getValue(item, name, null);
        }
        if (cost) {
            for (let curr of ["pp", "gp", "sp", "cp", "gc", "ss", "bp"]) {
                if (cost[curr] && cost[curr] != "0" && cost[curr] != 0) {
                    cost = `${cost[curr]} ${curr}`;
                    break;
                }
            }
        }

        if (name == "cost" && cost == undefined && typeof item !== "string" && !ignorePrice)
            cost = (item.system?.denomination != undefined ? item.system?.value.value + " " + item.system?.denomination.value : getValue(item, "price"));

        return cost;
    }

    static getPrice(cost) {
        let result = {};

        var countDecimals = function (value) {
            let parts = value.toString().split(".");
            if (parts.length == 1)
                return 0;
            return (parts[1].length || 0);
        }

        cost = "" + cost;
        let price = parseFloat(cost.replace(',', ''));
        if (price == 0 || isNaN(price)) {
            // Don't discard a currency unit that was actually present in the string (e.g. rmss's
            // getSystemPrice() always appends system.currency_type, even for a 0 value) just
            // because the amount is zero - only fall back to the default currency when none was
            // parseable at all.
            const zeroCurrency = cost.replace(/[^a-z]/gi, '');
            return { value: 0, currency: zeroCurrency || MEJHelpers.defaultCurrency() };
        }
        if (price < 0) {
            result.consume = true;
            price = Math.abs(price);
        }

        let currency = cost.replace(/[^a-z]/gi, '');

        if (currency == "")
            currency = MEJHelpers.defaultCurrency();

        if (parseInt(price) != price) {
            if (MonksEnhancedJournal.currencies.length > 1) {
                let numDecimal = price.toString().split(".")[1].length || 0;
                let currs = MonksEnhancedJournal.currencies.filter(c => {
                    if (!c.convert)
                        return false;
                    return countDecimals(c.convert) >= numDecimal;
                });
                let curr = null;

                let adjust = Math.pow(10, numDecimal);
                for (let tcurr of currs) {
                    let val = (price * adjust) / ((tcurr.convert || 1) * adjust);
                    if (val == Math.floor(val)) {
                        curr = tcurr;
                        currency = tcurr.id;
                        price = Math.floor(val);
                        break;
                    }
                }

                if (!curr) {
                    curr = MonksEnhancedJournal.currencies[MonksEnhancedJournal.currencies.length - 1];
                    currency = curr.id;
                    price = Math.floor(price / (curr.convert || 1));
                }
            } else
                price = Math.floor(price);
        }

        result.value = price;
        result.currency = currency;

        return result;
    }

    static setPrice(item, name, price) {
        if (game.system.id == "dnd5e" && foundry.utils.isNewerVersion(game.system.version, "2.0.3")) {
            setValue(item, name, { value: price.value, denomination: price.currency });
        } else if (game.system.id == "wfrp4e") {
            foundry.utils.setProperty(item, `system.price.${price.currency}`, price.value);
        } else if (game.system.id == "pf2e") {
            let value = {};
            value[price.currency] = price.value;
            setValue(item, name, { value: value }, {overwrite: true});
        } else if (game.system.id === "rmss") {
            // Mirror of the getSystemPrice rmss branch: write the amount as-is in its own
            // denomination (system.currency_type) instead of toDefaultCurrency's gold-converted
            // number, which would leave currency_type stale and the value silently rescaled.
            setValue(item, name, price.value);
            foundry.utils.setProperty(item, "system.currency_type", price.currency);
        } else {
            setValue(item, name, MEJHelpers.toDefaultCurrency(price));
        }
    }

    static toDefaultCurrency(price) {
        let value = (typeof price == "string" ? MEJHelpers.getPrice(price, "price") : price);
        let currency = MonksEnhancedJournal.currencies.find(c => c.id == value.currency);
        let result = (currency?.convert || 1) * value.value;

        return result;
    }

    /**
     * Create a purchased/looted item on the buyer's actor from fully-prepared itemData (quantity
     * and price already baked in by the caller). Routing this through sheet._onDropItem is wrong
     * for any actor sheet backed by itemData.uuid: Foundry's Item.fromDropData/fromUuid resolution
     * (and rmss's own override, which explicitly re-derives from droppedItem.toObject()) always
     * prefers that uuid over the inline data, silently discarding the purchased quantity/price and
     * re-creating the item at its original source quantity instead - for a repeat purchase this
     * also risks merging into an existing stack using that wrong source quantity rather than
     * creating a fresh item, which is what one system's bug report ("buying more than 1 doesn't
     * transfer") traced back to. _onDropItemCreate takes itemData as-is with no uuid detour, so it
     * still lets a system's sheet apply any of its own on-create defaults (e.g. auto-marking a
     * freshly acquired weapon as worn) without the data-loss bug.
     */
    static createOwnedItem(actor, itemData) {
        const sheet = actor.sheet;
        if (sheet?._onDropItemCreate)
            return sheet._onDropItemCreate(itemData, { preventDefault: () => {}, target: { closest: () => {} } });
        return actor.createEmbeddedDocuments("Item", [itemData]);
    }
}