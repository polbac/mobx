/**
 * mobservable
 * (c) 2015 - Michel Weststrate
 * https://github.com/mweststrate/mobservable
 */

import {deepEquals, makeNonEnumerable, Lambda, deprecated} from "../utils/utils";
import {Atom} from "../core/atom";
import {SimpleEventEmitter} from "../utils/simpleeventemitter";
import {ValueMode, assertUnwrapped, makeChildObservable} from "./modifiers";
import {checkIfStateModificationsAreAllowed} from "../core/globalstate";

export interface IObservableArray<T> extends Array<T> {
	spliceWithArray(index: number, deleteCount?: number, newItems?: T[]): T[];
	observe(listener: (changeData: IArrayChange<T>|IArraySplice<T>) => void, fireImmediately?: boolean): Lambda;
	clear(): T[];
	peek(): T[];
	replace(newItems: T[]): T[];
	find(predicate: (item: T, index: number, array: IObservableArray<T>) => boolean, thisArg?: any, fromIndex?: number): T;
	remove(value: T): boolean;
}

export interface IArrayChange<T> {
	type:  string; // Always:  "update'
	object:  IObservableArray<T>;
	index:  number;
	oldValue:  T;
}

export interface IArraySplice<T> {
	type:  string; // Always:  'splice'
	object:  IObservableArray<T>;
	index:  number;
	removed:  T[];
	addedCount:  number;
}

/**
 * This array buffer contains two lists of properties, so that all arrays
 * can recycle their property definitions, which significantly improves performance of creating
 * properties on the fly.
 */
let OBSERVABLE_ARRAY_BUFFER_SIZE = 0;

// Typescript workaround to make sure ObservableArray extends Array
export class StubArray {
}
StubArray.prototype = [];

export class ObservableArrayAdministration<T> {
	atom: Atom;
	values: T[];
	changeEvent: SimpleEventEmitter;
	lastKnownLength = 0;

	constructor(private array: ObservableArray<T>, public mode: ValueMode, public name: string) {
		this.atom = new Atom(name || "ObservableArray");
	}

	getLength(): number {
		this.atom.reportObserved();
		return this.values.length;
	}

	setLength(newLength): number {
		if (typeof newLength !== "number" || newLength < 0)
			throw new Error("[mobservable.array] Out of range: " + newLength);
		let currentLength = this.values.length;
		if (newLength === currentLength)
			return;
		else if (newLength > currentLength)
			this.spliceWithArray(currentLength, 0, new Array(newLength - currentLength));
		else
			this.spliceWithArray(newLength, currentLength - newLength);
	}

	// adds / removes the necessary numeric properties to this object
	updateLength(oldLength: number, delta: number) {
		if (oldLength !== this.lastKnownLength)
			throw new Error("[mobservable] Modification exception: the internal structure of an observable array was changed. Did you use peek() to change it?");
		checkIfStateModificationsAreAllowed();
		this.lastKnownLength += delta;
		if (delta > 0 && oldLength + delta > OBSERVABLE_ARRAY_BUFFER_SIZE)
			reserveArrayBuffer(oldLength + delta);
	}

	spliceWithArray(index: number, deleteCount?: number, newItems?: T[]): T[] {
		const length = this.values.length;
		if  ((newItems === undefined || newItems.length === 0) && (deleteCount === 0 || length === 0))
			return [];

		if (index === undefined)
			index = 0;
		else if (index > length)
			index = length;
		else if (index < 0)
			index = Math.max(0, length + index);

		if (arguments.length === 1)
			deleteCount = length - index;
		else if (deleteCount === undefined || deleteCount === null)
			deleteCount = 0;
		else
			deleteCount = Math.max(0, Math.min(deleteCount, length - index));

		if (newItems === undefined)
			newItems = [];
		else
			newItems = <T[]> newItems.map((value) => this.makeReactiveArrayItem(value));

		const lengthDelta = newItems.length - deleteCount;
		this.updateLength(length, lengthDelta); // create or remove new entries
		const res: T[] = this.values.splice(index, deleteCount, ...newItems);

		this.notifySplice(index, res, newItems);
		return res;
	}

	makeReactiveArrayItem(value) {
		assertUnwrapped(value, "Array values cannot have modifiers");
		if (this.mode === ValueMode.Flat || this.mode === ValueMode.Reference)
			return value;
		return makeChildObservable(value, this.mode, this.name + "[x]");
	}

	private notifyChildUpdate(index: number, oldValue: T) {
		this.atom.reportChanged();
		// conform: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/observe
		if (this.changeEvent)
			this.changeEvent.emit(<IArrayChange<T>>{ object: <IObservableArray<T>><any> this.array, type: "update", index: index, oldValue: oldValue});
	}

	private notifySplice(index: number, deleted:T[], added: T[]) {
		if (deleted.length === 0 && added.length === 0)
			return;
		this.atom.reportChanged();
		// conform: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/observe
		if (this.changeEvent)
			this.changeEvent.emit(<IArraySplice<T>>{ object: <IObservableArray<T>><any> this.array, type: "splice", index: index, addedCount: added.length, removed: deleted});
	}
}

export class ObservableArray<T> extends StubArray {
	$mobservable: ObservableArrayAdministration<T>;

	constructor(initialValues: T[], mode: ValueMode, name: string) {
		super();
		let adm = new ObservableArrayAdministration(this, mode, name);
		Object.defineProperty(this, "$mobservable", {
			enumerable: false,
			configurable: false,
			value : adm
		});

		if (initialValues && initialValues.length) {
			adm.updateLength(0, initialValues.length);
			adm.values = initialValues.map(v => adm.makeReactiveArrayItem(v));
		} else
			adm.values = [];
	}

	observe(listener: (changeData: IArrayChange<T>|IArraySplice<T>) => void, fireImmediately = false): Lambda {
		if (this.$mobservable.changeEvent === undefined)
			this.$mobservable.changeEvent = new SimpleEventEmitter();
		if (fireImmediately)
			listener(<IArraySplice<T>>{ object: <IObservableArray<T>><any> this, type: "splice", index: 0, addedCount: this.$mobservable.values.length, removed: []});
		return this.$mobservable.changeEvent.on(listener);
	}

	clear(): T[] {
		return this.splice(0);
	}

	replace(newItems: T[]) {
		return this.$mobservable.spliceWithArray(0, this.$mobservable.values.length, newItems);
	}

	toJSON(): T[] {
		this.$mobservable.atom.reportObserved();
		// JSON.stringify recurses on returned objects, so this will work fine
		return this.$mobservable.values.slice();
	}

	peek(): T[] {
		this.$mobservable.atom.reportObserved();
		return this.$mobservable.values;
	}

	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find
	find(predicate: (item: T, index: number, array: ObservableArray<T>) => boolean, thisArg?, fromIndex = 0): T {
		this.$mobservable.atom.reportObserved();
		const items = this.$mobservable.values, l = items.length;
		for (let i = fromIndex; i < l; i++)
			if (predicate.call(thisArg, items[i], i, this))
				return items[i];
		return null;
	}

	/*
		functions that do alter the internal structure of the array, (based on lib.es6.d.ts)
		since these functions alter the inner structure of the array, the have side effects.
		Because the have side effects, they should not be used in computed function,
		and for that reason the do not call dependencyState.notifyObserved
		*/
	splice(index: number, deleteCount?: number, ...newItems: T[]): T[] {
		switch (arguments.length) {
			case 0:
				return [];
			case 1:
				return this.$mobservable.spliceWithArray(index);
			case 2:
				return this.$mobservable.spliceWithArray(index, deleteCount);
		}
		return this.$mobservable.spliceWithArray(index, deleteCount, newItems);
	}

	push(...items: T[]): number {
		this.$mobservable.spliceWithArray(this.$mobservable.values.length, 0, items);
		return this.$mobservable.values.length;
	}

	pop(): T {
		return this.splice(Math.max(this.$mobservable.values.length - 1, 0), 1)[0];
	}

	shift(): T {
		return this.splice(0, 1)[0]
	}

	unshift(...items: T[]): number {
		this.$mobservable.spliceWithArray(0, 0, items);
		return this.$mobservable.values.length;
	}

	reverse():T[] {
		this.$mobservable.atom.reportObserved();
		// reverse by default mutates in place before returning the result
		// which makes it both a 'derivation' and a 'mutation'.
		// so we deviate from the default and just make it an dervitation
		const clone = (<any>this).slice();
		return clone.reverse.apply(clone, arguments);
	}

	sort(compareFn?: (a: T, b: T) => number): T[] {
		this.$mobservable.atom.reportObserved();
		// sort by default mutates in place before returning the result
		// which goes against all good practices. Let's not change the array in place!
		const clone = (<any>this).slice();
		return clone.sort.apply(clone, arguments);
	}

	remove(value:T):boolean {
		const idx = this.$mobservable.values.indexOf(value);
		if (idx > -1) {
			this.splice(idx, 1);
			return true;
		}
		return false;
	}

	toString(): string {
		return "[mobservable.array] " + Array.prototype.toString.apply(this.$mobservable.values, arguments);
	}

	toLocaleString(): string {
		return "[mobservable.array] " + Array.prototype.toLocaleString.apply(this.$mobservable.values, arguments);
	}
}

/**
 * We don't want those to show up in `for (const key in ar)` ...
 */
makeNonEnumerable(ObservableArray.prototype, [
	"constructor",
	"clear",
	"find",
	"observe",
	"pop",
	"peek",
	"push",
	"remove",
	"replace",
	"reverse",
	"shift",
	"sort",
	"splice",
	"split",
	"toJSON",
	"toLocaleString",
	"toString",
	"unshift"
]);
Object.defineProperty(ObservableArray.prototype, "length", {
	enumerable: false,
	configurable: true,
	get: function(): number {
		return this.$mobservable.getLength();
	},
	set: function(newLength: number) {
		this.$mobservable.setLength(newLength);
	}
});


/**
 * Wrap function from prototype
 */
[
	"concat",
	"every",
	"filter",
	"forEach",
	"indexOf",
	"join",
	"lastIndexOf",
	"map",
	"reduce",
	"reduceRight",
	"slice",
	"some"
].forEach(funcName => {
	const baseFunc = Array.prototype[funcName];
	Object.defineProperty(ObservableArray.prototype, funcName, {
		configurable: false,
		writable: true,
		enumerable: false,
		value: function() {
			this.$mobservable.atom.reportObserved();
			return baseFunc.apply(this.$mobservable.values, arguments);
		}
	});
});

function createArrayBufferItem(index: number) {
	Object.defineProperty(ObservableArray.prototype, "" + index, {
		enumerable: false,
		configurable: false,
		set: function(value) {
			const impl = this.$mobservable;
			const values = impl.values;
			assertUnwrapped(value, "Modifiers cannot be used on array values. For non-reactive array values use makeReactive(asFlat(array)).");
			if (index < values.length) {
				checkIfStateModificationsAreAllowed();
				const oldValue = values[index];
				const changed = impl.mode === ValueMode.Structure ? !deepEquals(oldValue, value) : oldValue !== value;
				if (changed) {
					values[index] = impl.makeReactiveArrayItem(value);
					impl.notifyChildUpdate(index, oldValue);
				}
			}
			else if (index === values.length)
				impl.spliceWithArray(index, 0, [impl.makeReactiveArrayItem(value)]);
			else
				throw new Error(`[mobservable.array] Index out of bounds, ${index} is larger than ${values.length}`);
		},
		get: function() {
			const impl = this.$mobservable;
			if (impl && index < impl.values.length) {
				impl.atom.reportObserved();
				return impl.values[index];
			}
			return undefined;
		}
	});
}

function reserveArrayBuffer(max:number) {
	for (let index = OBSERVABLE_ARRAY_BUFFER_SIZE; index < max; index++)
		createArrayBufferItem(index);
	OBSERVABLE_ARRAY_BUFFER_SIZE = max;
}

reserveArrayBuffer(1000);

export function createObservableArray<T>(initialValues: T[], mode: ValueMode, name: string): IObservableArray<T> {
	return <IObservableArray<T>><any> new ObservableArray(initialValues, mode, name);
}

export function fastArray<V>(initialValues?: V[]): IObservableArray<V> {
	deprecated("fastArray is deprecated. Please use `observable(asFlat([]))`");
	return createObservableArray(initialValues, ValueMode.Flat, null);
}

export function isObservableArray(thing):boolean {
	return thing instanceof ObservableArray;
}
