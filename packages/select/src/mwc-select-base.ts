/**
@license
Copyright 2020 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/// tslint:disable:strip-private-property-underscore

import '@material/mwc-notched-outline';
import '@material/mwc-menu';
import '@material/mwc-icon';

import {normalizeKey} from '@material/dom/keyboard';
import {MDCFloatingLabelFoundation} from '@material/floating-label/foundation.js';
import {MDCLineRippleFoundation} from '@material/line-ripple/foundation.js';
import {numbers} from '@material/list/constants';
import {MDCListTextAndIndex} from '@material/list/types';
import {addHasRemoveClass, FormElement} from '@material/mwc-base/form-element.js';
import {observer} from '@material/mwc-base/observer.js';
import {floatingLabel, FloatingLabel} from '@material/mwc-floating-label';
import {lineRipple, LineRipple} from '@material/mwc-line-ripple';
import {ListItemBase} from '@material/mwc-list/mwc-list-item-base';
import {Menu} from '@material/mwc-menu';
import {NotchedOutline} from '@material/mwc-notched-outline';
import {MDCSelectAdapter} from '@material/select/adapter';
import MDCSelectFoundation from '@material/select/foundation.js';
import {eventOptions, html, property, query, TemplateResult} from 'lit-element';
import {classMap} from 'lit-html/directives/class-map.js';
import {ifDefined} from 'lit-html/directives/if-defined.js';

// must be done to get past lit-analyzer checks
declare global {
  interface Element {
    floatingLabelFoundation?: MDCFloatingLabelFoundation;
    lineRippleFoundation?: MDCLineRippleFoundation;
  }
}

type CustomValidityState = {
  -readonly[P in keyof ValidityState]: ValidityState[P]
};

const createValidityObj =
    (customValidity: Partial<ValidityState> = {}): ValidityState => {
      /*
       * We need to make ValidityState an object because it is readonly and
       * we cannot use the spread operator. Also, we don't export
       * `CustomValidityState` because it is a leaky implementation and the user
       * already has access to `ValidityState` in lib.dom.ts. Also an interface
       * {a: Type} can be casted to {readonly a: Type} so passing any object
       * should be fine.
       */
      const objectifiedCustomValidity: Partial<CustomValidityState> = {};

      // eslint-disable-next-line guard-for-in
      for (const propName in customValidity) {
        /*
         * Casting is needed because ValidityState's props are all readonly and
         * thus cannot be set on `onjectifiedCustomValidity`. In the end, the
         * interface is the same as ValidityState (but not readonly), but the
         * function signature casts the output to ValidityState (thus readonly).
         */
        objectifiedCustomValidity[propName as keyof CustomValidityState] =
            customValidity[propName as keyof ValidityState];
      }

      return {
        badInput: false,
        customError: false,
        patternMismatch: false,
        rangeOverflow: false,
        rangeUnderflow: false,
        stepMismatch: false,
        tooLong: false,
        tooShort: false,
        typeMismatch: false,
        valid: true,
        valueMissing: false,
        ...objectifiedCustomValidity
      };
    };

/**
 * @fires selected {SelectedDetail}
 * @fires action {ActionDetail}
 * @fires opened
 * @fires closed
 * @fires change
 * @fires invalid
 */
export abstract class SelectBase extends FormElement {
  protected mdcFoundation!: MDCSelectFoundation;

  protected readonly mdcFoundationClass = MDCSelectFoundation;

  @query('.mdc-select') protected mdcRoot!: HTMLElement;

  @query('.formElement') protected formElement!: HTMLInputElement;

  @query('slot') protected slotElement!: HTMLSlotElement|null;

  @query('select') protected nativeSelectElement!: HTMLSelectElement|null;

  @query('input') protected nativeInputElement!: HTMLInputElement|null;

  @query('.mdc-line-ripple') protected lineRippleElement!: LineRipple|null;

  @query('.mdc-floating-label') protected labelElement!: FloatingLabel|null;

  @query('mwc-notched-outline') protected outlineElement!: NotchedOutline|null;

  @query('.mdc-menu') protected menuElement!: Menu|null;

  @query('.mdc-select__anchor') protected anchorElement!: HTMLDivElement|null;

  @property({type: Boolean, attribute: 'disabled', reflect: true})
  @observer(function(this: SelectBase, value: boolean) {
    if (this.renderReady) {
      this.mdcFoundation.setDisabled(value);
    }
  })
  disabled = false;

  @property({type: Boolean}) outlined = false;

  @property({type: String}) label = '';

  @property({type: Boolean}) protected outlineOpen = false;

  @property({type: Number}) protected outlineWidth = 0;

  @property({type: String})
  @observer(function(this: SelectBase, value: string) {
    if (this.mdcFoundation) {
      const initialization = this.selected === null && !!value;
      const valueSetByUser = this.selected && this.selected.value !== value;

      if (initialization || valueSetByUser) {
        this.selectByValue(value);
      }
      this.reportValidity();
    }
  })
  value = '';

  @property({type: String}) protected selectedText = '';

  @property({type: String}) icon = '';

  @property({type: Boolean}) protected menuOpen = false;

  @property({type: String}) helper = '';

  @property({type: Boolean}) validateOnInitialRender = false;

  @property({type: String}) validationMessage = '';

  @property({type: Boolean}) required = false;

  @property({type: Boolean}) fullwidth = false;

  @property({type: Boolean}) naturalMenuWidth = false;

  @property({type: Boolean}) protected isUiValid = true;

  // Transiently holds current typeahead prefix from user.
  protected typeaheadBuffer = '';
  protected typeaheadBufferClearTimeout = 0;
  // Persistently holds most recent first character typed by user.
  protected currentFirstChar = '';
  protected readonly sortedIndexByFirstChar =
      new Map<string, MDCListTextAndIndex[]>();
  protected sortedIndexCursor = 0;

  protected menuElement_: Menu|null = null;

  get items(): ListItemBase[] {
    // memoize menuElement to prevent unnecessary querySelector calls.
    if (!this.menuElement_) {
      this.menuElement_ = this.menuElement;
    }

    if (this.menuElement_) {
      return this.menuElement_.items;
    }

    return [];
  }

  get selected(): ListItemBase|null {
    const menuElement = this.menuElement;
    if (menuElement) {
      return menuElement.selected as ListItemBase | null;
    }

    return null;
  }

  get index(): number {
    const menuElement = this.menuElement;
    if (menuElement) {
      return menuElement.index as number;
    }

    return -1;
  }

  protected listeners: ({
    target: Element;
    name: string;
    cb: EventListenerOrEventListenerObject;
  })[] = [];
  protected onBodyClickBound: (evt: MouseEvent) => void = () => undefined;
  protected _menuUpdateComplete: null|Promise<unknown> = null;
  protected get shouldRenderHelperText(): boolean {
    return !!this.helper || !!this.validationMessage;
  }

  protected renderReady = false;
  protected valueSetDirectly = false;

  validityTransform:
      ((value: string,
        nativeValidity: ValidityState) => Partial<ValidityState>)|null = null;

  protected _validity: ValidityState = createValidityObj();

  get validity(): ValidityState {
    this._checkValidity(this.value);

    return this._validity;
  }

  render() {
    let outlinedOrUnderlined = html``;

    if (this.outlined) {
      outlinedOrUnderlined = this.renderOutlined();
    } else {
      outlinedOrUnderlined = this.renderUnderlined();
    }

    const classes = {
      'mdc-select--disabled': this.disabled,
      'mdc-select--no-label': !this.label,
      'mdc-select--filled': !this.outlined,
      'mdc-select--outlined': this.outlined,
      'mdc-select--with-leading-icon': !!this.icon,
      'mdc-select--required': this.required,
      'mdc-select--invalid': !this.isUiValid,
      'mdc-select--fullwidth': this.fullwidth,
    };

    const describedby = this.shouldRenderHelperText ? 'helper-text' : undefined;

    return html`
      <div
          class="mdc-select ${classMap(classes)}"
          @keydown=${this.handleTypeahead}>
        <input
            class="formElement"
            .value=${this.value}
            hidden
            ?required=${this.required}>
        <!-- @ts-ignore -->
        <div class="mdc-select__anchor"
            aria-autocomplete="none"
            role="combobox"
            aria-expanded=${this.menuOpen}
            aria-invalid=${!this.isUiValid}
            aria-haspopup="listbox"
            aria-labelledby="label"
            aria-required=${this.required}
            aria-describedby=${ifDefined(describedby)}
            @click=${this.onClick}
            @focus=${this.onFocus}
            @blur=${this.onBlur}
            @keydown=${this.onKeydown}>
          ${this.icon ? this.renderIcon(this.icon) : ''}
          <span class="mdc-select__selected-text">${this.selectedText}</span>
          <span class="mdc-select__dropdown-icon">
            <svg
                class="mdc-select__dropdown-icon-graphic"
                viewBox="7 10 10 5">
              <polygon
                  class="mdc-select__dropdown-icon-inactive"
                  stroke="none"
                  fill-rule="evenodd"
                  points="7 10 12 15 17 10">
              </polygon>
              <polygon
                  class="mdc-select__dropdown-icon-active"
                  stroke="none"
                  fill-rule="evenodd"
                  points="7 15 12 10 17 15">
              </polygon>
            </svg>
          </span>
          ${outlinedOrUnderlined}
        </div>
        <mwc-menu
            innerRole="listbox"
            wrapFocus
            class="mdc-select__menu mdc-menu mdc-menu-surface"
            activatable
            .fullwidth=${!this.naturalMenuWidth}
            .open=${this.menuOpen}
            .anchor=${this.anchorElement}
            @selected=${this.onSelected}
            @opened=${this.onOpened}
            @closed=${this.onClosed}
            @list-item-rendered=${this.onListItemConnected}>
          <slot></slot>
        </mwc-menu>
      </div>
      ${this.renderHelperText()}`;
  }

  protected renderHelperText() {
    const showValidationMessage = this.validationMessage && !this.isUiValid;
    const classes = {
      'mdc-select-helper-text--validation-msg': showValidationMessage,
      'hidden': !this.shouldRenderHelperText,
    };

    return html`
        <p
          class="mdc-select-helper-text ${classMap(classes)}"
          id="helper-text">${
        showValidationMessage ? this.validationMessage : this.helper}</p>`;
  }

  protected renderOutlined() {
    let labelTemplate: TemplateResult|string = '';
    if (this.label) {
      labelTemplate = this.renderLabel();
    }
    return html`
      <mwc-notched-outline
          .width=${this.outlineWidth}
          .open=${this.outlineOpen}
          class="mdc-notched-outline">
        ${labelTemplate}
      </mwc-notched-outline>`;
  }

  protected renderUnderlined() {
    let labelTemplate: TemplateResult|string = '';
    if (this.label) {
      labelTemplate = this.renderLabel();
    }

    return html`
      ${labelTemplate}
      <div .lineRippleFoundation=${lineRipple()}></div>
    `;
  }

  protected renderLabel() {
    return html`
      <label
          .floatingLabelFoundation=${floatingLabel(this.label)}
          @labelchange=${this.onLabelChange}
          id="label">
        ${this.label}
      </label>
    `;
  }

  protected renderIcon(icon: string) {
    return html`<mwc-icon class="mdc-select__icon"><div>${
        icon}</div></mwc-icon>`;
  }

  protected createAdapter(): MDCSelectAdapter {
    return {
      ...addHasRemoveClass(this.mdcRoot),
      activateBottomLine: () => {
        if (this.lineRippleElement) {
          this.lineRippleElement.lineRippleFoundation.activate();
        }
      },
      deactivateBottomLine: () => {
        if (this.lineRippleElement) {
          this.lineRippleElement.lineRippleFoundation.deactivate();
        }
      },
      getSelectedMenuItem: () => {
        const menuElement = this.menuElement;

        if (!menuElement) {
          return null;
        }

        return menuElement.selected as ListItemBase | null;
      },
      hasLabel: () => {
        return !!this.label;
      },
      floatLabel: (shouldFloat) => {
        if (this.labelElement) {
          this.labelElement.floatingLabelFoundation.float(shouldFloat);
        }
      },
      getLabelWidth: () => {
        if (this.labelElement) {
          return this.labelElement.floatingLabelFoundation.getWidth();
        }

        return 0;
      },
      hasOutline: () => this.outlined,
      notchOutline: (labelWidth) => {
        const outlineElement = this.outlineElement;
        if (outlineElement && !this.outlineOpen) {
          this.outlineWidth = labelWidth;
          this.outlineOpen = true;
        }
      },
      closeOutline: () => {
        if (this.outlineElement) {
          this.outlineOpen = false;
        }
      },
      setRippleCenter: (normalizedX) => {
        if (this.lineRippleElement) {
          const foundation = this.lineRippleElement.lineRippleFoundation;
          foundation.setRippleCenter(normalizedX);
        }
      },
      notifyChange: async (value) => {
        if (!this.valueSetDirectly && value === this.value) {
          return;
        }

        this.valueSetDirectly = false;
        this.value = value;
        await this.updateComplete;
        const ev = new Event('change', {bubbles: true});
        this.dispatchEvent(ev);
      },
      setSelectedText: (value) => this.selectedText = value,
      isSelectAnchorFocused: () => {
        const selectAnchorElement = this.anchorElement;

        if (!selectAnchorElement) {
          return false;
        }

        const rootNode =
            selectAnchorElement.getRootNode() as ShadowRoot | Document;

        return rootNode.activeElement === selectAnchorElement;
      },
      getSelectAnchorAttr: (attr) => {
        const selectAnchorElement = this.anchorElement;

        if (!selectAnchorElement) {
          return null;
        }

        return selectAnchorElement.getAttribute(attr);
      },
      setSelectAnchorAttr: (attr, value) => {
        const selectAnchorElement = this.anchorElement;

        if (!selectAnchorElement) {
          return;
        }

        selectAnchorElement.setAttribute(attr, value);
      },
      openMenu: () => {
        this.menuOpen = true;
      },
      closeMenu: () => {
        this.menuOpen = false;
      },
      getAnchorElement: () => this.anchorElement,
      setMenuAnchorElement: () => {
        /* Handled by anchor directive */
      },
      setMenuAnchorCorner: () => {
        const menuElement = this.menuElement;
        if (menuElement) {
          menuElement.corner = 'BOTTOM_START';
        }
      },
      setMenuWrapFocus: (wrapFocus) => {
        const menuElement = this.menuElement;
        if (menuElement) {
          menuElement.wrapFocus = wrapFocus;
        }
      },
      setAttributeAtIndex: () => undefined,
      focusMenuItemAtIndex: (index) => {
        const menuElement = this.menuElement;
        if (!menuElement) {
          return;
        }

        const element = menuElement.items[index];

        if (!element) {
          return;
        }

        (element as HTMLElement).focus();
      },
      getMenuItemCount: () => {
        const menuElement = this.menuElement;

        if (menuElement) {
          return menuElement.items.length;
        }

        return 0;
      },
      getMenuItemValues: () => {
        const menuElement = this.menuElement;

        if (!menuElement) {
          return [];
        }

        const items = menuElement.items;

        return items.map((item) => item.value);
      },
      getMenuItemTextAtIndex: (index) => {
        const menuElement = this.menuElement;
        if (!menuElement) {
          return '';
        }

        const element = menuElement.items[index];

        if (!element) {
          return '';
        }

        return element.text;
      },
      getMenuItemAttr: (menuItem) => {
        const listItem = menuItem as ListItemBase;
        return listItem.value;
      },
      addClassAtIndex: () => undefined,
      removeClassAtIndex: () => undefined,
    };
  }

  checkValidity(): boolean {
    const isValid = this._checkValidity(this.value);

    if (!isValid) {
      const invalidEvent =
          new Event('invalid', {bubbles: false, cancelable: true});
      this.dispatchEvent(invalidEvent);
    }

    return isValid;
  }

  reportValidity(): boolean {
    const isValid = this.checkValidity();

    this.isUiValid = isValid;

    return isValid;
  }

  protected _checkValidity(value: string) {
    const nativeValidity = this.formElement.validity;

    let validity = createValidityObj(nativeValidity);

    if (this.validityTransform) {
      const customValidity = this.validityTransform(value, validity);
      validity = {...validity, ...customValidity};
    }

    this._validity = validity;

    return this._validity.valid;
  }

  setCustomValidity(message: string) {
    this.validationMessage = message;
    this.formElement.setCustomValidity(message);
  }

  protected async _getUpdateComplete() {
    await this._menuUpdateComplete;
    await super._getUpdateComplete();
  }

  protected async firstUpdated() {
    const menuElement = this.menuElement;

    if (menuElement) {
      this._menuUpdateComplete = menuElement.updateComplete;
      await this._menuUpdateComplete;
    }

    super.firstUpdated();

    this.mdcFoundation.isValid = () => true;
    this.mdcFoundation.setValid = () => undefined;
    this.mdcFoundation.setDisabled(this.disabled);

    if (this.validateOnInitialRender) {
      this.reportValidity();
    }

    // init with value set
    if (this.value && !this.selected) {
      if (!this.items.length && this.slotElement &&
          this.slotElement.assignedNodes({flatten: true}).length) {
        // Shady DOM initial render fix
        await new Promise((res) => requestAnimationFrame(res));
        await this.layout();
      }

      this.selectByValue(this.value);
    }

    this.initTypeaheadState();
    this.renderReady = true;
  }

  protected onListItemConnected() {
    this.initTypeaheadState();
  }

  select(index: number) {
    const menuElement = this.menuElement;

    if (menuElement) {
      menuElement.select(index);
    }
  }

  protected selectByValue(value: string) {
    let indexToSelect = -1;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.value === value) {
        indexToSelect = i;
        break;
      }
    }
    this.valueSetDirectly = true;
    this.select(indexToSelect);
    this.mdcFoundation.handleChange();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    for (const listener of this.listeners) {
      listener.target.removeEventListener(listener.name, listener.cb);
    }
  }

  focus() {
    const focusEvt = new CustomEvent('focus');
    const selectAnchorElement = this.anchorElement;

    if (selectAnchorElement) {
      selectAnchorElement.dispatchEvent(focusEvt);
      selectAnchorElement.focus();
    }
  }

  blur() {
    const focusEvt = new CustomEvent('blur');
    const selectAnchorElement = this.anchorElement;

    if (selectAnchorElement) {
      selectAnchorElement.dispatchEvent(focusEvt);
      selectAnchorElement.blur();
    }
  }

  protected onFocus() {
    if (this.mdcFoundation) {
      this.mdcFoundation.handleFocus();
    }
  }

  protected onBlur() {
    if (this.mdcFoundation) {
      this.mdcFoundation.handleBlur();
    }

    const menuElement = this.menuElement;

    if (menuElement && !menuElement.open) {
      this.reportValidity();
    }
  }

  protected onClick(evt: MouseEvent|TouchEvent) {
    if (this.mdcFoundation) {
      this.focus();
      const targetClientRect = (evt.target as Element).getBoundingClientRect();
      let xCoord = 0;

      if ('touches' in evt) {
        xCoord = evt.touches[0].clientX;
      } else {
        xCoord = evt.clientX;
      }

      const normalizedX = xCoord - targetClientRect.left;
      this.mdcFoundation.handleClick(normalizedX);
    }
  }

  protected onKeydown(evt: KeyboardEvent) {
    if (this.mdcFoundation) {
      this.mdcFoundation.handleKeydown(evt);
    }
  }

  protected isTypeaheadInProgress(): boolean {
    return this.typeaheadBuffer.length > 0;
  }

  @eventOptions({capture: true})
  protected handleTypeahead(event: KeyboardEvent) {
    const isArrowLeft = normalizeKey(event) === 'ArrowLeft';
    const isArrowUp = normalizeKey(event) === 'ArrowUp';
    const isArrowRight = normalizeKey(event) === 'ArrowRight';
    const isArrowDown = normalizeKey(event) === 'ArrowDown';
    const isHome = normalizeKey(event) === 'Home';
    const isEnd = normalizeKey(event) === 'End';
    const isEnter = normalizeKey(event) === 'Enter';
    const isSpace = normalizeKey(event) === 'Spacebar';
    const isMeta =
        // tslint:disable-next-line:deprecation
        event.key === 'Meta' || event.keyCode === 91 || event.keyCode === 93;

    const ignoreTypeahead = isArrowLeft || isArrowUp || isArrowRight ||
        isArrowDown || isHome || isEnd || isEnter || isMeta;

    if (isSpace && this.isTypeaheadInProgress()) {
      // prevents space from selecting which is handled by mwc-list
      event.stopPropagation();
      event.preventDefault();
      // space participates in typeahead matching if in rapid typing mode
      this.typeaheadMatchItem(' ');
    } else if (!ignoreTypeahead && event.key.length === 1) {
      // focus first item matching prefix
      event.preventDefault();
      this.typeaheadMatchItem(event.key.toLowerCase());
    }
  }

  /**
   * Initializes typeahead state by indexing the current list items by primary
   * text into the sortedIndexByFirstChar data structure.
   */
  protected initTypeaheadState() {
    this.sortedIndexByFirstChar.clear();

    // Aggregate item text to index mapping
    for (let i = 0; i < this.items.length; i++) {
      const textAtIndex = this.items[i].text;
      if (!textAtIndex) {
        continue;
      }

      const firstChar = textAtIndex[0].toLowerCase();
      if (!this.sortedIndexByFirstChar.has(firstChar)) {
        this.sortedIndexByFirstChar.set(firstChar, []);
      }
      this.sortedIndexByFirstChar.get(firstChar)!.push(
          {text: this.items[i].text.toLowerCase(), index: i});
    }

    // Sort the mapping
    // TODO(b/157162694): Investigate replacing forEach with Map.values()
    this.sortedIndexByFirstChar.forEach((values) => {
      values.sort((first: MDCListTextAndIndex, second: MDCListTextAndIndex) => {
        return first.index - second.index;
      });
    });
  }

  /**
   * Given the next desired character from the user, adds it to the typeahead
   * buffer; then, beginning from the currently focused option, attempts to
   * find the next option matching the buffer. Wraps around if at the
   * end of options.
   */
  protected typeaheadMatchItem(nextChar: string) {
    clearTimeout(this.typeaheadBufferClearTimeout);

    this.typeaheadBufferClearTimeout =
        setTimeout(() => {
          this.typeaheadBuffer = '';
        }, numbers.TYPEAHEAD_BUFFER_CLEAR_TIMEOUT_MS) as unknown as number;

    this.typeaheadBuffer += nextChar;

    let index: number;
    if (this.typeaheadBuffer.length === 1) {
      index = this.matchFirstChar();
    } else {
      index = this.matchAllChars();
    }

    if (index !== -1 && this.menuElement) {
      this.menuElement.focusItemAtIndex(index);
    }
    return index;
  }

  /**
   * Matches the user's single input character in the buffer to the
   * next option that begins with such character. Wraps around if at
   * end of options.
   */
  protected matchFirstChar(): number {
    const menuElement = this.menuElement;
    const firstChar = this.typeaheadBuffer[0];
    const itemsMatchingFirstChar = this.sortedIndexByFirstChar.get(firstChar);
    if (!itemsMatchingFirstChar || !menuElement) {
      return -1;
    }

    // Has the same firstChar been recently matched?
    // Also, did focus remain the same between key presses?
    // If both hold true, simply increment index.
    if (firstChar === this.currentFirstChar &&
        itemsMatchingFirstChar[this.sortedIndexCursor].index ===
            menuElement.getFocusedItemIndex()) {
      this.sortedIndexCursor =
          (this.sortedIndexCursor + 1) % itemsMatchingFirstChar.length;

      return itemsMatchingFirstChar[this.sortedIndexCursor].index;
    }

    // If we're here, either firstChar changed, or focus was moved between
    // keypresses thus invalidating the cursor.
    this.currentFirstChar = firstChar;
    this.sortedIndexCursor = 0;

    // Advance cursor to first item matching the firstChar that is positioned
    // after focused item. Cursor is unchanged if there's no such item.
    for (let cursorPosition = 0; cursorPosition < itemsMatchingFirstChar.length;
         cursorPosition++) {
      if (itemsMatchingFirstChar[cursorPosition].index >
          menuElement.getFocusedItemIndex()) {
        this.sortedIndexCursor = cursorPosition;
        break;
      }
    }

    return itemsMatchingFirstChar[this.sortedIndexCursor].index;
  }

  /**
   * Attempts to find the next item that matches all of the typeahead buffer.
   * Wraps around if at end of options.
   */
  protected matchAllChars(): number {
    const firstChar = this.typeaheadBuffer[0];
    const itemsMatchingFirstChar = this.sortedIndexByFirstChar.get(firstChar);
    if (!itemsMatchingFirstChar) {
      return -1;
    }

    // Do nothing if text already matches
    if (itemsMatchingFirstChar[this.sortedIndexCursor].text.lastIndexOf(
            this.typeaheadBuffer, 0) === 0) {
      return itemsMatchingFirstChar[this.sortedIndexCursor].index;
    }

    // Find next item that matches completely; if no match, we'll eventually
    // loop around to same position
    let cursorPosition =
        (this.sortedIndexCursor + 1) % itemsMatchingFirstChar.length;
    while (cursorPosition !== this.sortedIndexCursor) {
      const matches = itemsMatchingFirstChar[cursorPosition].text.lastIndexOf(
                          this.typeaheadBuffer, 0) === 0;
      if (matches) {
        this.sortedIndexCursor = cursorPosition;
        break;
      }

      cursorPosition = (cursorPosition + 1) % itemsMatchingFirstChar.length;
    }
    return itemsMatchingFirstChar[this.sortedIndexCursor].index;
  }

  protected async onSelected(evt: CustomEvent<{index: number}>) {
    if (!this.mdcFoundation) {
      await this.updateComplete;
    }

    this.mdcFoundation.handleMenuItemAction(evt.detail.index);
  }

  protected onOpened() {
    if (this.mdcFoundation) {
      this.menuOpen = true;
      this.mdcFoundation.handleMenuOpened();
    }
  }

  protected onClosed() {
    if (this.mdcFoundation) {
      this.menuOpen = false;
      this.mdcFoundation.handleMenuClosed();
    }
  }

  protected async onLabelChange() {
    if (this.label) {
      await this.layout(false);
    }
  }

  async layout(updateItems = true) {
    if (this.mdcFoundation) {
      this.mdcFoundation.layout();
    }

    await this.updateComplete;

    const labelElement = this.labelElement;

    if (labelElement && this.outlineElement) {
      /* When the textfield automatically notches due to a value and label
       * being defined, the textfield may be set to `display: none` by the user.
       * this means that the notch is of size 0px. We provide this function so
       * that the user may manually resize the notch to the floated label's
       * width.
       */
      if (this.outlineOpen) {
        const labelWidth = labelElement.floatingLabelFoundation.getWidth();
        this.outlineWidth = labelWidth;
      }
    }

    const menuElement = this.menuElement;

    if (menuElement) {
      menuElement.layout(updateItems);
    }
  }
}
