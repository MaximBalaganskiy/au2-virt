import { DI, resolve, Registration } from '@aurelia/kernel';
import { Scope, BindingContext, astEvaluate, queueAsyncTask, getCollectionObserver } from '@aurelia/runtime';
import { IRenderLocation, IController, IViewFactory, IPlatform } from '@aurelia/runtime-html';
import { IInstruction } from '@aurelia/template-compiler';
import { BindingBehaviorExpression, ValueConverterExpression } from '@aurelia/expression-parser';

const IDomRenderer = /* @__PURE__ */ DI.createInterface("IDomRenderer");
const ICollectionStrategyLocator = /* @__PURE__ */ DI.createInterface("ICollectionStrategyLocator");
const VIRTUAL_REPEAT_NEAR_TOP = "near-top";
const VIRTUAL_REPEAT_NEAR_BOTTOM = "near-bottom";

function unwrapExpression(expression) {
  let unwrapped = false;
  while (expression instanceof BindingBehaviorExpression) {
    expression = expression.expression;
  }
  while (expression instanceof ValueConverterExpression) {
    expression = expression.expression;
    unwrapped = true;
  }
  return unwrapped ? expression : null;
}

const safeString = String;
const createMappedError = (code, ...details) => {
  const paddedCode = safeString(code).padStart(4, "0");
  const message = getMessageByCode(code, ...details);
  const link = `https://docs.aurelia.io/developer-guides/error-messages/ui-virtualization/aur${paddedCode}`;
  return new Error(`AUR${paddedCode}: ${message}

For more information, see: ${link}`);
} ;
var ErrorNames = /* @__PURE__ */ ((ErrorNames2) => {
  ErrorNames2[ErrorNames2["method_not_implemented"] = 99] = "method_not_implemented";
  ErrorNames2[ErrorNames2["virtual_repeat_horizontal_in_table"] = 6e3] = "virtual_repeat_horizontal_in_table";
  ErrorNames2[ErrorNames2["virtual_repeat_invalid_calculation_state"] = 6001] = "virtual_repeat_invalid_calculation_state";
  ErrorNames2[ErrorNames2["scroller_element_not_found"] = 6002] = "scroller_element_not_found";
  ErrorNames2[ErrorNames2["scroller_info_readonly"] = 6003] = "scroller_info_readonly";
  ErrorNames2[ErrorNames2["invalid_render_target"] = 6004] = "invalid_render_target";
  ErrorNames2[ErrorNames2["unsupported_collection_strategy"] = 6005] = "unsupported_collection_strategy";
  return ErrorNames2;
})(ErrorNames || {});
const errorsMap = {
  [99 /* method_not_implemented */]: "Method {{0}} not implemented",
  // AUR6000: Horizontal virtual-repeat is not supported inside table elements
  [6e3 /* virtual_repeat_horizontal_in_table */]: "Horizontal virtual-repeat is not supported inside table elements (TABLE, TBODY, THEAD, TFOOT).",
  // AUR6001: Invalid calculation state - Virtual repeater has no items
  [6001 /* virtual_repeat_invalid_calculation_state */]: "Invalid calculation state. Virtual repeater has no items.",
  // AUR6002: Unable to find a scroller element in the DOM tree
  [6002 /* scroller_element_not_found */]: "Unable to find a scroller element. Ensure the virtual repeat is within a scrollable container.",
  // AUR6003: Scroller info is readonly and cannot be modified
  [6003 /* scroller_info_readonly */]: "Scroller info is readonly and cannot be modified.",
  // AUR6004: Invalid render target - parent node is null
  [6004 /* invalid_render_target */]: "Invalid render target. The target element must have a parent node.",
  // AUR6005: Unsupported collection strategy - collection type not supported
  [6005 /* unsupported_collection_strategy */]: "Unable to find a strategy for collection type: {{0}}. Supported types: Array, null/undefined."
};
const getMessageByCode = (name, ...details) => {
  let cooked = errorsMap[name];
  for (let i = 0; i < details.length; ++i) {
    const regex = new RegExp(`{{${i}(:.*)?}}`, "g");
    let matches = regex.exec(cooked);
    while (matches != null) {
      const method = matches[1]?.slice(1);
      let value = details[i];
      if (value != null) {
        switch (method) {
          case "join(!=)":
            value = value.join("!=");
            break;
          case "element":
            value = value === "*" ? "all elements" : `<${value} />`;
            break;
          default: {
            if (method?.startsWith(".")) {
              value = safeString(value[method.slice(1)]);
            } else {
              value = safeString(value);
            }
          }
        }
      }
      cooked = cooked.slice(0, matches.index) + value + cooked.slice(regex.lastIndex);
      matches = regex.exec(cooked);
    }
  }
  return cooked;
};

const getScrollerElement = (element, orientation) => {
  let current = element.parentNode;
  while (current !== null && current !== document.body) {
    if (hasOverflowScroll(current, orientation)) {
      return current;
    }
    current = current.parentNode;
  }
  throw createMappedError(ErrorNames.scroller_element_not_found);
};
const hasOverflowScroll = (element, orientation) => {
  const style = window.getComputedStyle(element);
  if (orientation === "vertical") {
    return style != null && (style.overflowY === "scroll" || style.overflow === "scroll" || style.overflowY === "auto" || style.overflow === "auto");
  }
  return style != null && (style.overflowX === "scroll" || style.overflow === "scroll" || style.overflowX === "auto" || style.overflow === "auto");
};
const getStyleValues = (element, ...styles) => {
  const currentStyle = window.getComputedStyle(element);
  let value = 0;
  let styleValue = 0;
  for (let i = 0, ii = styles.length; ii > i; ++i) {
    styleValue = parseFloat(currentStyle[styles[i]]);
    value += isNaN(styleValue) ? 0 : styleValue;
  }
  return value;
};
const calcOuterHeight = (element) => {
  let height = element.getBoundingClientRect().height;
  height += getStyleValues(element, "marginTop", "marginBottom");
  return height;
};
const calcOuterWidth = (element) => {
  let width = element.getBoundingClientRect().width;
  width += getStyleValues(element, "marginLeft", "marginRight");
  return width;
};
const calcScrollerViewportHeight = (element) => {
  let height = element.getBoundingClientRect().height;
  height -= getStyleValues(element, "borderTopWidth", "borderBottomWidth", "paddingTop", "paddingBottom");
  return height;
};
const calcScrollerViewportWidth = (element) => {
  let width = element.getBoundingClientRect().width;
  width -= getStyleValues(element, "borderLeftWidth", "borderRightWidth", "paddingLeft", "paddingRight");
  return width;
};
const getDistanceToScroller = (child, scroller) => {
  const offsetParent = child.offsetParent;
  const childOffsetTop = child.offsetTop;
  if (offsetParent === null || offsetParent === scroller) {
    return childOffsetTop;
  }
  if (offsetParent.contains(scroller)) {
    return childOffsetTop - scroller.offsetTop;
  }
  return childOffsetTop + getDistanceToScroller(offsetParent, scroller);
};
const getHorizontalDistanceToScroller = (child, scroller) => {
  const offsetParent = child.offsetParent;
  const childOffsetLeft = child.offsetLeft;
  if (offsetParent === null || offsetParent === scroller) {
    return childOffsetLeft;
  }
  if (offsetParent.contains(scroller)) {
    return childOffsetLeft - scroller.offsetLeft;
  }
  return childOffsetLeft + getHorizontalDistanceToScroller(offsetParent, scroller);
};

class VirtualRepeat {
  constructor() {
    // bindable
    this.items = void 0;
    /** @internal */
    this.views = [];
    /** @internal */
    this.task = null;
    this.itemHeight = 0;
    this.itemWidth = 0;
    this.minViewsRequired = 0;
    this.dom = null;
    /** @internal */
    this._configuredLayout = "vertical";
    /** @internal */
    this._configuredVariableHeight = false;
    /** @internal */
    this._configuredVariableWidth = false;
    // Variable sizing support
    /** @internal */
    this._itemHeights = [];
    /** @internal */
    this._itemWidths = [];
    /** @internal */
    this._cumulativeHeights = [];
    /** @internal */
    this._cumulativeWidths = [];
    this.location = resolve(IRenderLocation);
    this.instruction = resolve(IInstruction);
    this.parent = resolve(IController);
    /** @internal */
    this._factory = resolve(IViewFactory);
    /** @internal */
    this._strategyLocator = resolve(ICollectionStrategyLocator);
    /** @internal */
    this._domRenderer = resolve(IDomRenderer);
    /** @internal */
    this._attached = false;
    /** @internal */
    this.p = resolve(IPlatform);
    /** @internal */
    this._prevScroll = 0;
    const iteratorInstruction = this.instruction.props[0];
    const forOf = iteratorInstruction.forOf;
    const iterable = this.iterable = unwrapExpression(forOf.iterable) ?? forOf.iterable;
    const hasWrapExpression = this._hasWrapExpression = forOf.iterable !== iterable;
    this._obsMediator = new CollectionObservationMediator(this, () => hasWrapExpression ? this._handleInnerCollectionChange() : this._handleCollectionChange());
    this.local = forOf.declaration.name;
    const extraProps = iteratorInstruction.props ?? [];
    for (const p of extraProps) {
      if (p == null) continue;
      const initialText = `${p.to}:${p.value}`;
      const pairs = initialText.split(";");
      for (const pair of pairs) {
        const [rawKey, rawVal] = pair.split(":");
        if (!rawKey || rawVal === void 0) continue;
        const key = rawKey.trim();
        const valueStr = rawVal.trim();
        const valNum = Number(valueStr);
        switch (key) {
          case "itemHeight":
          case "item-height": {
            if (!Number.isNaN(valNum) && valNum > 0) {
              this._configuredItemHeight = valNum;
            }
            break;
          }
          case "itemWidth":
          case "item-width": {
            if (!Number.isNaN(valNum) && valNum > 0) {
              this._configuredItemWidth = valNum;
            }
            break;
          }
          case "bufferSize":
          case "buffer-size": {
            if (!Number.isNaN(valNum) && valNum > 0) {
              this._configuredBufferSize = valNum;
            }
            break;
          }
          case "minViews":
          case "min-views": {
            if (!Number.isNaN(valNum) && valNum > 0) {
              this._configuredMinViews = valNum;
            }
            break;
          }
          case "layout": {
            if (valueStr === "horizontal" || valueStr === "vertical") {
              this._configuredLayout = valueStr;
            }
            break;
          }
          case "variableHeight":
          case "variable-height": {
            if (valueStr === "true" || valueStr === "1") {
              this._configuredVariableHeight = true;
            }
            break;
          }
          case "variableWidth":
          case "variable-width": {
            if (valueStr === "true" || valueStr === "1") {
              this._configuredVariableWidth = true;
            }
            break;
          }
        }
      }
    }
  }
  /**
   * @internal
   */
  attaching() {
    this.dom = this._domRenderer.render(this.location, this._configuredLayout);
    const parentTag = this.dom.anchor.parentNode.tagName;
    if (this._configuredLayout === "horizontal" && (parentTag === "TBODY" || parentTag === "THEAD" || parentTag === "TFOOT" || parentTag === "TABLE")) {
      throw createMappedError(ErrorNames.virtual_repeat_horizontal_in_table);
    }
    this._obsMediator.start(this.items);
    this.collectionStrategy = this._strategyLocator.getStrategy(this.items);
    this._unsubscribeScroller = this._observeScroller();
    this._attached = true;
    this._onResize();
  }
  /**
   * @internal
   */
  detaching() {
    this._attached = false;
    this._unsubscribeScroller?.();
    this.task?.cancel();
    this._resetCalculation();
    this.dom.dispose();
    this._obsMediator.stop();
    this.dom = this.task = null;
  }
  /** @internal */
  _observeScroller() {
    const scroller = this.dom.scroller;
    const obs = new this.p.window.ResizeObserver(() => {
      if (!this._attached) return;
      this._onResize();
    });
    const handleScroll = () => this.handleScroll(scroller);
    obs.observe(scroller);
    scroller.addEventListener("scroll", handleScroll);
    return () => {
      obs.disconnect();
      scroller.removeEventListener("scroll", handleScroll);
    };
  }
  /** @internal */
  _onResize() {
    const itemCount = this.collectionStrategy.count;
    const hasItems = itemCount > 0;
    if (!hasItems) {
      return;
    }
    const firstView = this._createAndActivateFirstView();
    const isHorizontal = this._configuredLayout === "horizontal";
    const firstElement = firstView.nodes.firstChild;
    const itemHeight = this._configuredItemHeight ?? calcOuterHeight(firstElement);
    const itemWidth = this._configuredItemWidth ?? calcOuterWidth(firstElement);
    const scroller = this.dom.scroller;
    const viewportSize = isHorizontal ? calcScrollerViewportWidth(scroller) : calcScrollerViewportHeight(scroller);
    const canScroll = () => isHorizontal ? scroller.scrollWidth > viewportSize : scroller.scrollHeight > viewportSize;
    if (!canScroll()) {
      const viewCount = this.views.length;
      this.dom.update(0, (isHorizontal ? itemWidth : itemHeight) * (itemCount - viewCount));
    }
    this.itemHeight = itemHeight;
    this.itemWidth = itemWidth;
    if (!canScroll()) {
      this.minViewsRequired = itemCount;
      return;
    } else {
      const minViews = this._configuredMinViews ?? viewportSize / (isHorizontal ? itemWidth : itemHeight);
      this.minViewsRequired = Math.ceil(minViews);
      if (isHorizontal && this._configuredVariableWidth || !isHorizontal && this._configuredVariableHeight) {
        this._measureAndStoreItemSize(firstView, 0);
      }
    }
    this._handleItemsChanged(this.items, this.collectionStrategy);
  }
  /**
   * @internal
   */
  _resetCalculation() {
    this.minViewsRequired = 0;
    this.itemHeight = 0;
    this.itemWidth = 0;
    this.dom.update(0, 0);
    this._itemHeights.length = 0;
    this._itemWidths.length = 0;
    this._cumulativeHeights = [];
    this._cumulativeWidths = [];
  }
  /**
   * @internal
   */
  _measureAndStoreItemSize(view, index) {
    const element = view.nodes.firstChild;
    if (element == null) return;
    const height = calcOuterHeight(element);
    const width = calcOuterWidth(element);
    this._itemHeights[index] = height;
    this._itemWidths[index] = width;
  }
  /**
   * @internal
   */
  _buildCumulativeSizes(itemCount) {
    this._cumulativeHeights = new Array(itemCount);
    let cumulativeHeight = 0;
    for (let i = 0; i < itemCount; i++) {
      const height = this._itemHeights[i] ?? this.itemHeight;
      cumulativeHeight += height;
      this._cumulativeHeights[i] = cumulativeHeight;
    }
    this._cumulativeWidths = new Array(itemCount);
    let cumulativeWidth = 0;
    for (let i = 0; i < itemCount; i++) {
      const width = this._itemWidths[i] ?? this.itemWidth;
      cumulativeWidth += width;
      this._cumulativeWidths[i] = cumulativeWidth;
    }
  }
  /**
   * @internal
   */
  _findIndexByPosition(position, isHorizontal) {
    const cumulative = isHorizontal ? this._cumulativeWidths : this._cumulativeHeights;
    if (cumulative.length === 0) {
      const itemSize = isHorizontal ? this.itemWidth : this.itemHeight;
      return itemSize > 0 ? Math.floor(position / itemSize) : 0;
    }
    let left = 0;
    let right = cumulative.length - 1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const cumulativeSize = cumulative[mid];
      const prevCumulativeSize = mid > 0 ? cumulative[mid - 1] : 0;
      if (position >= prevCumulativeSize && position < cumulativeSize) {
        return mid;
      } else if (position < prevCumulativeSize) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }
    return Math.max(0, Math.min(left, cumulative.length - 1));
  }
  /**
   * @internal
   */
  _getPositionForIndex(index, isHorizontal) {
    const cumulative = isHorizontal ? this._cumulativeWidths : this._cumulativeHeights;
    if (cumulative.length === 0 || index === 0) {
      return 0;
    }
    if (index >= cumulative.length) {
      const itemSize = isHorizontal ? this.itemWidth : this.itemHeight;
      return index * itemSize;
    }
    return index > 0 ? cumulative[index - 1] : 0;
  }
  /** @internal */
  _handleItemsChanged(items, collectionStrategy) {
    const repeatController = this.$controller;
    const itemCount = collectionStrategy.count;
    const views = this.views;
    let i = 0;
    let currViewCount = views.length;
    let view = null;
    if (itemCount === 0) {
      for (i = 0; currViewCount > i; ++i) {
        view = views[i];
        void view.deactivate(view, repeatController);
      }
      views.splice(0);
      this._resetCalculation();
      return;
    }
    if (this.itemHeight === 0) {
      return;
    }
    const bufferMultiplier = this._configuredBufferSize ?? 2;
    const maxViewsRequired = this.minViewsRequired * bufferMultiplier;
    const realViewCount = Math.min(maxViewsRequired, itemCount);
    if (currViewCount > maxViewsRequired) {
      while (currViewCount > maxViewsRequired) {
        view = views[currViewCount - 1];
        void view.deactivate(view, repeatController);
        --currViewCount;
      }
      views.splice(currViewCount);
    }
    if (currViewCount > itemCount) {
      while (currViewCount > itemCount) {
        view = views[currViewCount - 1];
        void view.deactivate(view, repeatController);
        --currViewCount;
      }
      views.splice(itemCount);
    }
    currViewCount = views.length;
    for (i = currViewCount; i < realViewCount; i++) {
      views.push(this._factory.create());
    }
    const isHorizontal = this._configuredLayout === "horizontal";
    const itemHeight = this.itemHeight;
    const itemSize = isHorizontal ? this.itemWidth : itemHeight;
    const local = this.local;
    const {
      firstIndex,
      topCount,
      botCount
    } = this.measureBuffer(this.dom.scroller, views.length, itemCount, itemHeight);
    let idx = 0;
    let item;
    let prevView;
    let scope;
    for (i = 0; realViewCount > i; ++i) {
      idx = firstIndex + i;
      item = collectionStrategy.item(idx);
      view = views[i];
      prevView = views[i - 1];
      if (view.isActive) {
        scope = view.scope;
        scope.bindingContext[local] = item;
        scope.overrideContext.$index = idx;
        scope.overrideContext.$length = itemCount;
      } else {
        view.nodes.insertBefore(prevView.nodes.firstChild.nextSibling);
        scope = Scope.fromParent(
          repeatController.scope,
          new BindingContext(local, collectionStrategy.item(idx))
        );
        scope.overrideContext.$index = idx;
        scope.overrideContext.$length = itemCount;
        enhanceOverrideContext(scope.overrideContext);
        void view.activate(repeatController, repeatController, scope);
      }
      if (isHorizontal && this._configuredVariableWidth || !isHorizontal && this._configuredVariableHeight) {
        this._measureAndStoreItemSize(view, idx);
      }
    }
    if (isHorizontal && this._configuredVariableWidth || !isHorizontal && this._configuredVariableHeight) {
      this._buildCumulativeSizes(itemCount);
    }
    let topBufferSize = 0;
    let botBufferSize = 0;
    if (isHorizontal && this._configuredVariableWidth || !isHorizontal && this._configuredVariableHeight) {
      topBufferSize = this._getPositionForIndex(topCount, isHorizontal);
      botBufferSize = this._getPositionForIndex(itemCount - firstIndex - realViewCount, isHorizontal);
    } else {
      topBufferSize = topCount * itemSize;
      botBufferSize = botCount * itemSize;
    }
    this.dom.update(topBufferSize, botBufferSize);
  }
  /** @internal */
  itemsChanged(items) {
    this._obsMediator.start(items);
    this.collectionStrategy = this._strategyLocator.getStrategy(items);
    this._queueHandleItemsChanged();
  }
  /**
   * The value returned by HTMLElement.prototype.scrollTop isn't always reliable.
   * When the virtual repeater is placed after a long list of elements, its "real" scrolltop
   * will be different with this value. An example is virtual repeat on table,
   * the header shouldn't be of the scroll top calculation
   *
   * @internal
   */
  _calcRealScrollTop(scroller) {
    const scroller_scroll_top = scroller.scrollTop;
    const top_buffer_distance = getDistanceToScroller(this.dom.top, scroller);
    const real_scroll_top = Math.max(0, scroller_scroll_top === 0 ? 0 : scroller_scroll_top - top_buffer_distance);
    return real_scroll_top;
  }
  /**
   * Similar to _calcRealScrollTop but for horizontal scrolling
   *
   * @internal
   */
  _calcRealScrollLeft(scroller) {
    const scroller_scroll_left = scroller.scrollLeft;
    const left_buffer_distance = getHorizontalDistanceToScroller(this.dom.top, scroller);
    const real_scroll_left = Math.max(0, scroller_scroll_left === 0 ? 0 : scroller_scroll_left - left_buffer_distance);
    return real_scroll_left;
  }
  /** @internal */
  measureBuffer(scroller, viewCount, collectionSize, itemHeight) {
    const isHorizontal = this._configuredLayout === "horizontal";
    const isVariableSizing = isHorizontal ? this._configuredVariableWidth : this._configuredVariableHeight;
    if (isVariableSizing && (isHorizontal ? this._cumulativeWidths.length > 0 : this._cumulativeHeights.length > 0)) {
      return this._measureBufferVariable(scroller, viewCount, collectionSize, isHorizontal);
    } else {
      return this._measureBufferFixed(scroller, viewCount, collectionSize, itemHeight, isHorizontal);
    }
  }
  /** @internal */
  _measureBufferFixed(scroller, viewCount, collectionSize, itemHeight, isHorizontal) {
    const itemSize = isHorizontal ? this.itemWidth : itemHeight;
    const realScroll = isHorizontal ? this._calcRealScrollLeft(scroller) : this._calcRealScrollTop(scroller);
    let first_index_after_scroll_adjustment = realScroll === 0 ? 0 : Math.floor(realScroll / itemSize);
    if (first_index_after_scroll_adjustment + viewCount >= collectionSize) {
      first_index_after_scroll_adjustment = Math.max(0, collectionSize - viewCount);
    }
    const top_buffer_item_count_after_scroll_adjustment = first_index_after_scroll_adjustment;
    const bot_buffer_item_count_after_scroll_adjustment = Math.max(
      0,
      collectionSize - top_buffer_item_count_after_scroll_adjustment - viewCount
    );
    return {
      firstIndex: first_index_after_scroll_adjustment,
      topCount: top_buffer_item_count_after_scroll_adjustment,
      botCount: bot_buffer_item_count_after_scroll_adjustment
    };
  }
  /** @internal */
  _measureBufferVariable(scroller, viewCount, collectionSize, isHorizontal) {
    const realScroll = isHorizontal ? this._calcRealScrollLeft(scroller) : this._calcRealScrollTop(scroller);
    let first_index_after_scroll_adjustment = realScroll === 0 ? 0 : this._findIndexByPosition(realScroll, isHorizontal);
    if (first_index_after_scroll_adjustment + viewCount >= collectionSize) {
      first_index_after_scroll_adjustment = Math.max(0, collectionSize - viewCount);
    }
    const top_buffer_item_count_after_scroll_adjustment = first_index_after_scroll_adjustment;
    const bot_buffer_item_count_after_scroll_adjustment = Math.max(
      0,
      collectionSize - top_buffer_item_count_after_scroll_adjustment - viewCount
    );
    return {
      firstIndex: first_index_after_scroll_adjustment,
      topCount: top_buffer_item_count_after_scroll_adjustment,
      botCount: bot_buffer_item_count_after_scroll_adjustment
    };
  }
  /** @internal */
  handleScroll(scroller) {
    const views = this.views;
    const viewCount = views.length;
    if (viewCount === 0) {
      return;
    }
    const local = this.local;
    const isHorizontal = this._configuredLayout === "horizontal";
    const itemHeight = this.itemHeight;
    const itemSize = isHorizontal ? this.itemWidth : itemHeight;
    const repeatDom = this.dom;
    const collectionStrategy = this.collectionStrategy;
    const collectionSize = collectionStrategy.count;
    const prevFirstIndex = views[0].scope.overrideContext.$index;
    const {
      firstIndex: currFirstIndex,
      topCount: topCount1,
      botCount: botCount1
    } = this.measureBuffer(scroller, viewCount, collectionSize, itemHeight);
    const isScrollingTowardsEnd = isHorizontal ? scroller.scrollLeft > this._prevScroll : scroller.scrollTop > this._prevScroll;
    const isJumping = isScrollingTowardsEnd ? currFirstIndex >= prevFirstIndex + viewCount : currFirstIndex + viewCount <= prevFirstIndex;
    this._prevScroll = isHorizontal ? scroller.scrollLeft : scroller.scrollTop;
    if (currFirstIndex === prevFirstIndex) {
      return;
    }
    let view = null;
    let scope = null;
    let idx = 0;
    let viewsToMoveCount = 0;
    let idxIncrement = 0;
    let i = 0;
    if (isJumping) {
      for (i = 0; viewCount > i; ++i) {
        idx = currFirstIndex + i;
        scope = views[i].scope;
        scope.bindingContext[local] = collectionStrategy.item(idx);
        scope.overrideContext.$index = idx;
        scope.overrideContext.$length = collectionSize;
      }
    } else if (isScrollingTowardsEnd) {
      viewsToMoveCount = currFirstIndex - prevFirstIndex;
      while (viewsToMoveCount > 0) {
        view = views.shift();
        idx = views[views.length - 1].scope.overrideContext["$index"] + 1;
        views.push(view);
        scope = view.scope;
        scope.bindingContext[local] = collectionStrategy.item(idx);
        scope.overrideContext.$index = idx;
        scope.overrideContext.$length = collectionSize;
        view.nodes.insertBefore(repeatDom.bottom);
        ++idxIncrement;
        --viewsToMoveCount;
      }
    } else {
      viewsToMoveCount = prevFirstIndex - currFirstIndex;
      while (viewsToMoveCount > 0) {
        idx = prevFirstIndex - (idxIncrement + 1);
        view = views.pop();
        scope = view.scope;
        scope.bindingContext[local] = collectionStrategy.item(idx);
        scope.overrideContext.$index = idx;
        scope.overrideContext.$length = collectionSize;
        view.nodes.insertBefore(views[0].nodes.firstChild);
        views.unshift(view);
        ++idxIncrement;
        --viewsToMoveCount;
      }
    }
    if (isScrollingTowardsEnd) {
      if (collectionStrategy.isNearBottom(currFirstIndex + (viewCount - 1))) {
        repeatDom.scroller.dispatchEvent(new CustomEvent(VIRTUAL_REPEAT_NEAR_BOTTOM, {
          bubbles: true,
          detail: {
            lastVisibleIndex: currFirstIndex + (viewCount - 1),
            itemCount: collectionSize
          }
        }));
      }
    } else {
      if (collectionStrategy.isNearTop(views[0].scope.overrideContext["$index"])) {
        repeatDom.scroller.dispatchEvent(new CustomEvent(VIRTUAL_REPEAT_NEAR_TOP, {
          bubbles: true,
          detail: {
            firstVisibleIndex: views[0].scope.overrideContext["$index"],
            itemCount: collectionSize
          }
        }));
      }
    }
    let topBufferSize = 0;
    let botBufferSize = 0;
    if (isHorizontal && this._configuredVariableWidth || !isHorizontal && this._configuredVariableHeight) {
      topBufferSize = this._getPositionForIndex(topCount1, isHorizontal);
      botBufferSize = this._getPositionForIndex(botCount1, isHorizontal);
    } else {
      topBufferSize = topCount1 * itemSize;
      botBufferSize = botCount1 * itemSize;
    }
    repeatDom.update(topBufferSize, botBufferSize);
  }
  getDistances() {
    return this.dom?.distances ?? [0, 0];
  }
  getViews() {
    return this.views.slice(0);
  }
  /**
   * todo: handle update based on collection, rather than always update
   *
   * @internal
   */
  _handleCollectionChange() {
    this._queueHandleItemsChanged();
  }
  /**
   * @internal
   */
  _handleInnerCollectionChange() {
    const newItems = astEvaluate(this.iterable, this.parent.scope, { strict: true }, null);
    const oldItems = this.items;
    this.items = newItems;
    if (newItems === oldItems) {
      this._queueHandleItemsChanged();
    }
  }
  /** @internal */
  _queueHandleItemsChanged() {
    const task = this.task;
    this.task = queueAsyncTask(() => {
      this.task = null;
      this._handleItemsChanged(this.items, this.collectionStrategy);
    });
    task?.cancel();
  }
  /**
   * @internal
   */
  _createAndActivateFirstView() {
    const firstView = this.getOrCreateFirstView();
    if (!firstView.isActive) {
      const repeatController = this.$controller;
      const collectionStrategy = this.collectionStrategy;
      const parentScope = repeatController.scope;
      const itemScope = Scope.fromParent(
        parentScope,
        new BindingContext(this.local, collectionStrategy.first())
      );
      itemScope.overrideContext.$index = 0;
      itemScope.overrideContext.$length = collectionStrategy.count;
      enhanceOverrideContext(itemScope.overrideContext);
      firstView.nodes.insertBefore(this.dom.bottom);
      void firstView.activate(firstView, repeatController, itemScope);
    }
    return firstView;
  }
  /**
   * @internal
   */
  getOrCreateFirstView() {
    const views = this.views;
    if (views.length > 0) {
      return views[0];
    }
    const view = this._factory.create();
    views.push(view);
    return view;
  }
}
VirtualRepeat.$au = {
  type: "custom-attribute",
  name: "virtual-repeat",
  isTemplateController: true,
  bindables: {
    local: true,
    items: { primary: true }
  }
};
class CollectionObservationMediator {
  constructor(repeat, handleCollectionChange) {
    this.repeat = repeat;
    this.handleCollectionChange = handleCollectionChange;
  }
  start(c) {
    if (this._collection === c) {
      return;
    }
    this.stop();
    if (c != null) {
      getCollectionObserver(this._collection = c)?.subscribe(this);
    }
  }
  stop() {
    getCollectionObserver(this._collection)?.unsubscribe(this);
  }
}
const enhancedContextCached = /* @__PURE__ */ new WeakSet();
function enhanceOverrideContext(context) {
  const ctx = context;
  if (enhancedContextCached.has(ctx)) {
    return;
  }
  Object.defineProperties(ctx, {
    $first: createGetterDescriptor($first),
    $last: createGetterDescriptor($last),
    $middle: createGetterDescriptor($middle),
    $even: createGetterDescriptor($even),
    $odd: createGetterDescriptor($odd)
  });
}
function createGetterDescriptor(getter) {
  return { configurable: true, enumerable: true, get: getter };
}
function $even() {
  return this.$index % 2 === 0;
}
function $odd() {
  return this.$index % 2 !== 0;
}
function $first() {
  return this.$index === 0;
}
function $last() {
  return this.$index === this.$length - 1;
}
function $middle() {
  return this.$index > 0 && this.$index < this.$length - 1;
}

class CollectionStrategyLocator {
  static register(container) {
    return Registration.singleton(ICollectionStrategyLocator, this).register(container);
  }
  getStrategy(items) {
    if (items == null) {
      return new NullCollectionStrategy();
    }
    if (items instanceof Array) {
      return new ArrayCollectionStrategy(items);
    }
    throw createMappedError(ErrorNames.unsupported_collection_strategy, typeof items);
  }
}
class ArrayCollectionStrategy {
  constructor(val) {
    this.val = val;
  }
  get count() {
    return this.val.length;
  }
  first() {
    return this.count > 0 ? this.val[0] : null;
  }
  last() {
    return this.count > 0 ? this.val[this.count - 1] : null;
  }
  item(index) {
    return this.val[index] ?? null;
  }
  range(start, end) {
    const val = this.val;
    const len = this.count;
    if (len > start && end > start) {
      return val.slice(start, end);
    }
    return [];
  }
  isNearTop(index) {
    return index < 5;
  }
  isNearBottom(index) {
    return index > this.val.length - 5;
  }
}
class NullCollectionStrategy {
  constructor() {
    this.val = null;
    this.count = 0;
  }
  isNearTop() {
    return false;
  }
  isNearBottom() {
    return false;
  }
  first() {
    return null;
  }
  last() {
    return null;
  }
  item() {
    return null;
  }
  range() {
    return [];
  }
}

class DefaultDomRenderer {
  constructor(p) {
    this.p = p;
  }
  /** @internal */
  static get inject() {
    return [IPlatform];
  }
  static register(container) {
    return Registration.singleton(IDomRenderer, this).register(container);
  }
  render(target, layout = "vertical") {
    const doc = this.p.document;
    const parent = target.parentNode;
    if (parent === null) {
      throw createMappedError(ErrorNames.invalid_render_target);
    }
    let bufferEls;
    switch (parent.tagName) {
      case "TBODY":
      case "THEAD":
      case "TFOOT":
      case "TABLE":
        bufferEls = insertBefore(doc, "tr", target);
        return new TableDom(parent.closest("table"), target, bufferEls[0], bufferEls[1], layout);
      case "UL":
      case "OL":
        bufferEls = insertBefore(doc, "div", target);
        return new ListDom(parent, target, bufferEls[0], bufferEls[1], layout);
      default:
        bufferEls = insertBefore(doc, "div", target);
        return new DefaultDom(target, bufferEls[0], bufferEls[1], layout);
    }
  }
}
class DefaultDom {
  constructor(anchor, top, bottom, layout) {
    this.anchor = anchor;
    this.top = top;
    this.bottom = bottom;
    this.layout = layout;
    this.tH = 0;
    this.bH = 0;
  }
  get scroller() {
    return getScrollerElement(this.anchor, this.layout);
  }
  get distances() {
    return [this.tH, this.bH];
  }
  update(top, bot) {
    if (this.layout === "horizontal") {
      this.top.style.width = `${this.tH = top}px`;
      this.bottom.style.width = `${this.bH = bot}px`;
      this.top.style.height = "100%";
      this.bottom.style.height = "100%";
      this.top.style.display = "inline-block";
      this.bottom.style.display = "inline-block";
    } else {
      this.top.style.height = `${this.tH = top}px`;
      this.bottom.style.height = `${this.bH = bot}px`;
      this.top.style.width = "";
      this.bottom.style.width = "";
      this.top.style.display = "";
      this.bottom.style.display = "";
    }
  }
  dispose() {
    this.top.remove();
    this.bottom.remove();
  }
}
class ListDom extends DefaultDom {
  constructor(list, anchor, top, bottom, layout) {
    super(anchor, top, bottom, layout);
    this.list = list;
  }
  get scroller() {
    return getScrollerElement(this.list, this.layout);
  }
}
class TableDom extends DefaultDom {
  constructor(table, anchor, top, bottom, layout) {
    super(anchor, top, bottom, layout);
    this.table = table;
  }
  get scroller() {
    return getScrollerElement(this.table, this.layout);
  }
}
function insertBefore(doc, el, target) {
  const parent = target.parentNode;
  return [
    parent.insertBefore(doc.createElement(el), target),
    parent.insertBefore(doc.createElement(el), target)
  ];
}

const DefaultVirtualizationConfiguration = {
  register(container) {
    return container.register(
      CollectionStrategyLocator,
      DefaultDomRenderer,
      VirtualRepeat
    );
  }
};

export { CollectionStrategyLocator, DefaultDomRenderer, DefaultVirtualizationConfiguration, ICollectionStrategyLocator, IDomRenderer, VIRTUAL_REPEAT_NEAR_BOTTOM, VIRTUAL_REPEAT_NEAR_TOP, VirtualRepeat };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguZGV2Lm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2ludGVyZmFjZXMudHMiLCIuLi8uLi9zcmMvdXRpbGl0aWVzLXJlcGVhdC50cyIsIi4uLy4uL3NyYy9lcnJvcnMudHMiLCIuLi8uLi9zcmMvdXRpbGl0aWVzLWRvbS50cyIsIi4uLy4uL3NyYy92aXJ0dWFsLXJlcGVhdC50cyIsIi4uLy4uL3NyYy9jb2xsZWN0aW9uLXN0cmF0ZWd5LnRzIiwiLi4vLi4vc3JjL3ZpcnR1YWwtcmVwZWF0LWRvbS1yZW5kZXJlci50cyIsIi4uLy4uL3NyYy9jb25maWd1cmF0aW9uLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IERJIH0gZnJvbSAnQGF1cmVsaWEva2VybmVsJztcbmltcG9ydCB0eXBlIHsgSURpc3Bvc2FibGUgfSBmcm9tICdAYXVyZWxpYS9rZXJuZWwnO1xuaW1wb3J0IHR5cGUge1xuICBDb2xsZWN0aW9uLFxuICBJbmRleE1hcCxcbn0gZnJvbSAnQGF1cmVsaWEvcnVudGltZSc7XG5pbXBvcnQgdHlwZSB7XG4gIElDb250cm9sbGVyLFxuICBJUmVuZGVyTG9jYXRpb24sIElTeW50aGV0aWNWaWV3LFxufSBmcm9tICdAYXVyZWxpYS9ydW50aW1lLWh0bWwnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElWaXJ0dWFsUmVwZWF0ZXI8VCBleHRlbmRzIENvbGxlY3Rpb24gPSBDb2xsZWN0aW9uPiB7XG4gIHJlYWRvbmx5IGl0ZW1zOiBUIHwgdW5kZWZpbmVkIHwgbnVsbDtcbiAgcmVhZG9ubHkgbG9jYXRpb246IElSZW5kZXJMb2NhdGlvbjtcbiAgcmVhZG9ubHkgJGNvbnRyb2xsZXI/OiBJQ29udHJvbGxlcjtcblxuICBnZXRWaWV3cygpOiByZWFkb25seSBJU3ludGhldGljVmlld1tdO1xuICBnZXREaXN0YW5jZXMoKTogW3RvcDogbnVtYmVyLCBib3R0b206IG51bWJlcl07XG59XG5cbmV4cG9ydCBjb25zdCBJRG9tUmVuZGVyZXIgPSAvKkBfX1BVUkVfXyovREkuY3JlYXRlSW50ZXJmYWNlPElEb21SZW5kZXJlcj4oJ0lEb21SZW5kZXJlcicpO1xuZXhwb3J0IGludGVyZmFjZSBJRG9tUmVuZGVyZXIge1xuICByZW5kZXIodGFyZ2V0OiBIVE1MRWxlbWVudCB8IElSZW5kZXJMb2NhdGlvbiwgbGF5b3V0PzogJ3ZlcnRpY2FsJyB8ICdob3Jpem9udGFsJyk6IElWaXJ0dWFsUmVwZWF0RG9tO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElWaXJ0dWFsUmVwZWF0RG9tIGV4dGVuZHMgSURpc3Bvc2FibGUge1xuICByZWFkb25seSBhbmNob3I6IEhUTUxFbGVtZW50IHwgSVJlbmRlckxvY2F0aW9uO1xuICByZWFkb25seSB0b3A6IEhUTUxFbGVtZW50O1xuICByZWFkb25seSBib3R0b206IEhUTUxFbGVtZW50O1xuICByZWFkb25seSBsYXlvdXQ6ICd2ZXJ0aWNhbCcgfCAnaG9yaXpvbnRhbCc7XG5cbiAgcmVhZG9ubHkgc2Nyb2xsZXI6IEhUTUxFbGVtZW50O1xuXG4gIGdldCBkaXN0YW5jZXMoKTogW251bWJlciwgbnVtYmVyXTtcblxuICB1cGRhdGUodG9wOiBudW1iZXIsIGJvdDogbnVtYmVyKTogdm9pZDtcbn1cblxuZXhwb3J0IGNvbnN0IElDb2xsZWN0aW9uU3RyYXRlZ3lMb2NhdG9yID0gLypAX19QVVJFX18qL0RJLmNyZWF0ZUludGVyZmFjZTxJQ29sbGVjdGlvblN0cmF0ZWd5TG9jYXRvcj4oJ0lDb2xsZWN0aW9uU3RyYXRlZ3lMb2NhdG9yJyk7XG5leHBvcnQgaW50ZXJmYWNlIElDb2xsZWN0aW9uU3RyYXRlZ3lMb2NhdG9yIHtcbiAgZ2V0U3RyYXRlZ3koaXRlbXM6IHVua25vd24pOiBJQ29sbGVjdGlvblN0cmF0ZWd5O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElDb2xsZWN0aW9uU3RyYXRlZ3k8VCBleHRlbmRzIENvbGxlY3Rpb24gPSBDb2xsZWN0aW9uPiB7XG4gIHJlYWRvbmx5IHZhbDogVCB8IG51bGw7XG5cbiAgLyoqXG4gICAqIENvdW50IHRoZSBudW1iZXIgb2YgdGhlIGl0ZW1zIGluIHRoZSByZXBlYXRhYmxlIHZhbHVlIGBpdGVtc2BcbiAgICovXG4gIHJlYWRvbmx5IGNvdW50OiBudW1iZXI7XG5cbiAgZmlyc3QoKTogdW5rbm93bjtcblxuICBsYXN0KCk6IHVua25vd247XG5cbiAgaXRlbShpbmRleDogbnVtYmVyKTogdW5rbm93bjtcblxuICByYW5nZShzdGFydDogbnVtYmVyLCBlbmQ6IG51bWJlcik6IHVua25vd25bXTtcblxuICAvKipcbiAgICogUmV0dXJucyB0cnVlIGlmIGEgZ2l2ZW4gaW5kZXggaXMgYXBwcm9hY2hpbmcgdGhlIHN0YXJ0IG9mIGEgY29sbGVjdGlvblxuICAgKiBWaXJ0dWFsIHJlcGVhdCBjYW4gdXNlIHRoaXMgdG8gaW52b2tlIGluZmluaXRlIHNjcm9sbCBuZXh0XG4gICAqL1xuICBpc05lYXJUb3AoaW5kZXg6IG51bWJlcik6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiBhIGdpdmVuIGluZGV4IGlzIGFwcHJvYWNoaW5nIHRoZSBlbmQgb2YgYSBjb2xsZWN0aW9uXG4gICAqIFZpcnR1YWwgcmVwZWF0IGNhbiB1c2UgdGhpcyB0byBpbnZva2UgaW5maW5pdGUgc2Nyb2xsIG5leHRcbiAgICovXG4gIGlzTmVhckJvdHRvbShpbmRleDogbnVtYmVyKTogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJQ29sbGVjdGlvblN0cmF0ZWd5U3Vic2NyaWJlcjxUIGV4dGVuZHMgQ29sbGVjdGlvbiA9IENvbGxlY3Rpb24+IHtcbiAgaGFuZGxlQ29sbGVjdGlvbk11dGF0aW9uKGNvbGxlY3Rpb246IFQsIGluZGV4TWFwOiBJbmRleE1hcCk6IHZvaWQ7XG59XG5cbmV4cG9ydCBjb25zdCBWSVJUVUFMX1JFUEVBVF9ORUFSX1RPUCA9ICduZWFyLXRvcCc7XG5leHBvcnQgY29uc3QgVklSVFVBTF9SRVBFQVRfTkVBUl9CT1RUT00gPSAnbmVhci1ib3R0b20nO1xuXG5leHBvcnQgaW50ZXJmYWNlIElWaXJ0dWFsUmVwZWF0TmVhclRvcEV2ZW50IGV4dGVuZHMgQ3VzdG9tRXZlbnQge1xuICByZWFkb25seSB0eXBlOiAnbmVhci10b3AnO1xuICByZWFkb25seSBkZXRhaWw6IHtcbiAgICByZWFkb25seSBmaXJzdFZpc2libGVJbmRleDogbnVtYmVyO1xuICAgIHJlYWRvbmx5IGl0ZW1Db3VudDogbnVtYmVyO1xuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElWaXJ0dWFsUmVwZWF0TmVhckJvdHRvbUV2ZW50IGV4dGVuZHMgQ3VzdG9tRXZlbnQge1xuICByZWFkb25seSB0eXBlOiAnbmVhci1ib3R0b20nO1xuICByZWFkb25seSBkZXRhaWw6IHtcbiAgICByZWFkb25seSBsYXN0VmlzaWJsZUluZGV4OiBudW1iZXI7XG4gICAgcmVhZG9ubHkgaXRlbUNvdW50OiBudW1iZXI7XG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSVZpcnR1YWxSZXBlYXRFdmVudENhbGxiYWNrcyB7XG4gICduZWFyLXRvcCc/OiAoZXZlbnQ6IElWaXJ0dWFsUmVwZWF0TmVhclRvcEV2ZW50KSA9PiB2b2lkO1xuICAnbmVhci1ib3R0b20nPzogKGV2ZW50OiBJVmlydHVhbFJlcGVhdE5lYXJCb3R0b21FdmVudCkgPT4gdm9pZDtcbn1cbiIsImltcG9ydCB7XG4gIEJpbmRpbmdCZWhhdmlvckV4cHJlc3Npb24sXG4gIElzQmluZGluZ0JlaGF2aW9yLFxuICBWYWx1ZUNvbnZlcnRlckV4cHJlc3Npb24sXG59IGZyb20gJ0BhdXJlbGlhL2V4cHJlc3Npb24tcGFyc2VyJztcblxuZXhwb3J0IGZ1bmN0aW9uIHVud3JhcEV4cHJlc3Npb24oZXhwcmVzc2lvbjogSXNCaW5kaW5nQmVoYXZpb3IpIHtcbiAgbGV0IHVud3JhcHBlZCA9IGZhbHNlO1xuICB3aGlsZSAoZXhwcmVzc2lvbiBpbnN0YW5jZW9mIEJpbmRpbmdCZWhhdmlvckV4cHJlc3Npb24pIHtcbiAgICBleHByZXNzaW9uID0gZXhwcmVzc2lvbi5leHByZXNzaW9uO1xuICB9XG4gIHdoaWxlIChleHByZXNzaW9uIGluc3RhbmNlb2YgVmFsdWVDb252ZXJ0ZXJFeHByZXNzaW9uKSB7XG4gICAgZXhwcmVzc2lvbiA9IGV4cHJlc3Npb24uZXhwcmVzc2lvbjtcbiAgICB1bndyYXBwZWQgPSB0cnVlO1xuICB9XG4gIHJldHVybiB1bndyYXBwZWQgPyBleHByZXNzaW9uIDogbnVsbDtcbn1cbiIsIi8qIGVzbGludC1kaXNhYmxlIEB0eXBlc2NyaXB0LWVzbGludC9uby11bnNhZmUtbWVtYmVyLWFjY2VzcyAqL1xuLyogZXNsaW50LWRpc2FibGUgcHJlZmVyLXRlbXBsYXRlICovXG5cbi8qKlxuICogVUkgVmlydHVhbGl6YXRpb24gRXJyb3IgQ29kZXMgKEFVUjYwMDAtQVVSNjk5OSlcbiAqXG4gKiBUaGlzIGZpbGUgY2VudHJhbGl6ZXMgYWxsIGVycm9yIGhhbmRsaW5nIGZvciB0aGUgdWktdmlydHVhbGl6YXRpb24gcGFja2FnZSxcbiAqIGZvbGxvd2luZyBBdXJlbGlhJ3MgQVVSIGVycm9yIGNvZGUgY29udmVudGlvbi4gRWFjaCBlcnJvciBoYXM6XG4gKlxuICogLSBBIHVuaXF1ZSBudW1lcmljIGNvZGUgaW4gdGhlIHJhbmdlIDYwMDAtNjk5OVxuICogLSBBIGRlc2NyaXB0aXZlIGNvbnN0YW50IG5hbWUgaW4gdGhlIEVycm9yTmFtZXMgZW51bVxuICogLSBBIHVzZXItZnJpZW5kbHkgZXJyb3IgbWVzc2FnZSB3aXRoIHBhcmFtZXRlciBzdWJzdGl0dXRpb25cbiAqIC0gQXV0b21hdGljIGxpbmtpbmcgdG8gZG9jdW1lbnRhdGlvbiAoaW4gZGV2ZWxvcG1lbnQgYnVpbGRzKVxuICpcbiAqIEVycm9yIENvZGUgQXNzaWdubWVudHM6XG4gKiAtIEFVUjYwMDA6IFZpcnR1YWwgcmVwZWF0IGhvcml6b250YWwgbGF5b3V0IG5vdCBzdXBwb3J0ZWQgaW4gdGFibGUgZWxlbWVudHNcbiAqIC0gQVVSNjAwMTogSW52YWxpZCBjYWxjdWxhdGlvbiBzdGF0ZSB3aGVuIHZpcnR1YWwgcmVwZWF0ZXIgaGFzIG5vIGl0ZW1zXG4gKiAtIEFVUjYwMDI6IFVuYWJsZSB0byBmaW5kIGEgc2Nyb2xsZXIgZWxlbWVudCBpbiB0aGUgRE9NIHRyZWVcbiAqIC0gQVVSNjAwMzogU2Nyb2xsZXIgaW5mbyBpcyByZWFkb25seSBhbmQgY2Fubm90IGJlIG1vZGlmaWVkXG4gKiAtIEFVUjYwMDQ6IEludmFsaWQgcmVuZGVyIHRhcmdldCAtIHBhcmVudCBub2RlIGlzIG51bGxcbiAqIC0gQVVSNjAwNTogVW5zdXBwb3J0ZWQgY29sbGVjdGlvbiBzdHJhdGVneSBmb3IgdGhlIGdpdmVuIGNvbGxlY3Rpb24gdHlwZVxuICovXG5cbmNvbnN0IHNhZmVTdHJpbmcgPSBTdHJpbmc7XG5cbi8qKiBAaW50ZXJuYWwgKi9cbmV4cG9ydCBjb25zdCBjcmVhdGVNYXBwZWRFcnJvcjogQ3JlYXRlRXJyb3IgPSBfX0RFVl9fXG4gID8gKGNvZGU6IEVycm9yTmFtZXMsIC4uLmRldGFpbHM6IHVua25vd25bXSkgPT4ge1xuICAgIGNvbnN0IHBhZGRlZENvZGUgPSBzYWZlU3RyaW5nKGNvZGUpLnBhZFN0YXJ0KDQsICcwJyk7XG4gICAgY29uc3QgbWVzc2FnZSA9IGdldE1lc3NhZ2VCeUNvZGUoY29kZSwgLi4uZGV0YWlscyk7XG4gICAgY29uc3QgbGluayA9IGBodHRwczovL2RvY3MuYXVyZWxpYS5pby9kZXZlbG9wZXItZ3VpZGVzL2Vycm9yLW1lc3NhZ2VzL3VpLXZpcnR1YWxpemF0aW9uL2F1ciR7cGFkZGVkQ29kZX1gO1xuICAgIHJldHVybiBuZXcgRXJyb3IoYEFVUiR7cGFkZGVkQ29kZX06ICR7bWVzc2FnZX1cXG5cXG5Gb3IgbW9yZSBpbmZvcm1hdGlvbiwgc2VlOiAke2xpbmt9YCk7XG4gIH1cbiAgOiAoY29kZTogRXJyb3JOYW1lcywgLi4uZGV0YWlsczogdW5rbm93bltdKSA9PiB7XG4gICAgY29uc3QgcGFkZGVkQ29kZSA9IHNhZmVTdHJpbmcoY29kZSkucGFkU3RhcnQoNCwgJzAnKTtcbiAgICByZXR1cm4gbmV3IEVycm9yKGBBVVIke3BhZGRlZENvZGV9OiR7ZGV0YWlscy5tYXAoc2FmZVN0cmluZyl9YCk7XG4gIH07XG5cbl9TVEFSVF9DT05TVF9FTlVNKCk7XG4vKiogQGludGVybmFsICovXG5leHBvcnQgY29uc3QgZW51bSBFcnJvck5hbWVzIHtcbiAgbWV0aG9kX25vdF9pbXBsZW1lbnRlZCA9IDk5LFxuXG4gIC8vIFVJIFZpcnR1YWxpemF0aW9uIHNwZWNpZmljIGVycm9ycyAoNjAwMC02OTk5KVxuICB2aXJ0dWFsX3JlcGVhdF9ob3Jpem9udGFsX2luX3RhYmxlID0gNjAwMCxcbiAgdmlydHVhbF9yZXBlYXRfaW52YWxpZF9jYWxjdWxhdGlvbl9zdGF0ZSA9IDYwMDEsXG4gIHNjcm9sbGVyX2VsZW1lbnRfbm90X2ZvdW5kID0gNjAwMixcbiAgc2Nyb2xsZXJfaW5mb19yZWFkb25seSA9IDYwMDMsXG4gIGludmFsaWRfcmVuZGVyX3RhcmdldCA9IDYwMDQsXG4gIHVuc3VwcG9ydGVkX2NvbGxlY3Rpb25fc3RyYXRlZ3kgPSA2MDA1LFxufVxuX0VORF9DT05TVF9FTlVNKCk7XG5cbmNvbnN0IGVycm9yc01hcDogUmVjb3JkPEVycm9yTmFtZXMsIHN0cmluZz4gPSB7XG4gIFtFcnJvck5hbWVzLm1ldGhvZF9ub3RfaW1wbGVtZW50ZWRdOiAnTWV0aG9kIHt7MH19IG5vdCBpbXBsZW1lbnRlZCcsXG5cbiAgLy8gQVVSNjAwMDogSG9yaXpvbnRhbCB2aXJ0dWFsLXJlcGVhdCBpcyBub3Qgc3VwcG9ydGVkIGluc2lkZSB0YWJsZSBlbGVtZW50c1xuICBbRXJyb3JOYW1lcy52aXJ0dWFsX3JlcGVhdF9ob3Jpem9udGFsX2luX3RhYmxlXTogJ0hvcml6b250YWwgdmlydHVhbC1yZXBlYXQgaXMgbm90IHN1cHBvcnRlZCBpbnNpZGUgdGFibGUgZWxlbWVudHMgKFRBQkxFLCBUQk9EWSwgVEhFQUQsIFRGT09UKS4nLFxuXG4gIC8vIEFVUjYwMDE6IEludmFsaWQgY2FsY3VsYXRpb24gc3RhdGUgLSBWaXJ0dWFsIHJlcGVhdGVyIGhhcyBubyBpdGVtc1xuICBbRXJyb3JOYW1lcy52aXJ0dWFsX3JlcGVhdF9pbnZhbGlkX2NhbGN1bGF0aW9uX3N0YXRlXTogJ0ludmFsaWQgY2FsY3VsYXRpb24gc3RhdGUuIFZpcnR1YWwgcmVwZWF0ZXIgaGFzIG5vIGl0ZW1zLicsXG5cbiAgLy8gQVVSNjAwMjogVW5hYmxlIHRvIGZpbmQgYSBzY3JvbGxlciBlbGVtZW50IGluIHRoZSBET00gdHJlZVxuICBbRXJyb3JOYW1lcy5zY3JvbGxlcl9lbGVtZW50X25vdF9mb3VuZF06ICdVbmFibGUgdG8gZmluZCBhIHNjcm9sbGVyIGVsZW1lbnQuIEVuc3VyZSB0aGUgdmlydHVhbCByZXBlYXQgaXMgd2l0aGluIGEgc2Nyb2xsYWJsZSBjb250YWluZXIuJyxcblxuICAvLyBBVVI2MDAzOiBTY3JvbGxlciBpbmZvIGlzIHJlYWRvbmx5IGFuZCBjYW5ub3QgYmUgbW9kaWZpZWRcbiAgW0Vycm9yTmFtZXMuc2Nyb2xsZXJfaW5mb19yZWFkb25seV06ICdTY3JvbGxlciBpbmZvIGlzIHJlYWRvbmx5IGFuZCBjYW5ub3QgYmUgbW9kaWZpZWQuJyxcblxuICAvLyBBVVI2MDA0OiBJbnZhbGlkIHJlbmRlciB0YXJnZXQgLSBwYXJlbnQgbm9kZSBpcyBudWxsXG4gIFtFcnJvck5hbWVzLmludmFsaWRfcmVuZGVyX3RhcmdldF06ICdJbnZhbGlkIHJlbmRlciB0YXJnZXQuIFRoZSB0YXJnZXQgZWxlbWVudCBtdXN0IGhhdmUgYSBwYXJlbnQgbm9kZS4nLFxuXG4gIC8vIEFVUjYwMDU6IFVuc3VwcG9ydGVkIGNvbGxlY3Rpb24gc3RyYXRlZ3kgLSBjb2xsZWN0aW9uIHR5cGUgbm90IHN1cHBvcnRlZFxuICBbRXJyb3JOYW1lcy51bnN1cHBvcnRlZF9jb2xsZWN0aW9uX3N0cmF0ZWd5XTogJ1VuYWJsZSB0byBmaW5kIGEgc3RyYXRlZ3kgZm9yIGNvbGxlY3Rpb24gdHlwZToge3swfX0uIFN1cHBvcnRlZCB0eXBlczogQXJyYXksIG51bGwvdW5kZWZpbmVkLicsXG59O1xuXG5jb25zdCBnZXRNZXNzYWdlQnlDb2RlID0gKG5hbWU6IEVycm9yTmFtZXMsIC4uLmRldGFpbHM6IHVua25vd25bXSkgPT4ge1xuICBsZXQgY29va2VkOiBzdHJpbmcgPSBlcnJvcnNNYXBbbmFtZV07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZGV0YWlscy5sZW5ndGg7ICsraSkge1xuICAgIGNvbnN0IHJlZ2V4ID0gbmV3IFJlZ0V4cChge3ske2l9KDouKik/fX1gLCAnZycpO1xuICAgIGxldCBtYXRjaGVzID0gcmVnZXguZXhlYyhjb29rZWQpO1xuICAgIHdoaWxlIChtYXRjaGVzICE9IG51bGwpIHtcbiAgICAgIGNvbnN0IG1ldGhvZCA9IG1hdGNoZXNbMV0/LnNsaWNlKDEpO1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbiAgICAgIGxldCB2YWx1ZSA9IGRldGFpbHNbaV0gYXMgYW55O1xuICAgICAgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgc3dpdGNoIChtZXRob2QpIHtcbiAgICAgICAgICBjYXNlICdqb2luKCE9KSc6IHZhbHVlID0gKHZhbHVlIGFzIHVua25vd25bXSkuam9pbignIT0nKTsgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnZWxlbWVudCc6IHZhbHVlID0gdmFsdWUgPT09ICcqJyA/ICdhbGwgZWxlbWVudHMnIDogYDwke3ZhbHVlfSAvPmA7IGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgIC8vIHByb3BlcnR5IGFjY2Vzc1xuICAgICAgICAgICAgaWYgKG1ldGhvZD8uc3RhcnRzV2l0aCgnLicpKSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gc2FmZVN0cmluZyh2YWx1ZVttZXRob2Quc2xpY2UoMSldKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gc2FmZVN0cmluZyh2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb29rZWQgPSBjb29rZWQuc2xpY2UoMCwgbWF0Y2hlcy5pbmRleCkgKyB2YWx1ZSArIGNvb2tlZC5zbGljZShyZWdleC5sYXN0SW5kZXgpO1xuICAgICAgbWF0Y2hlcyA9IHJlZ2V4LmV4ZWMoY29va2VkKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNvb2tlZDtcbn07XG5cbnR5cGUgQ3JlYXRlRXJyb3IgPSAoY29kZTogRXJyb3JOYW1lcywgLi4uZGV0YWlsczogdW5rbm93bltdKSA9PiBFcnJvcjtcbiIsImltcG9ydCB7IElTeW50aGV0aWNWaWV3IH0gZnJvbSAnQGF1cmVsaWEvcnVudGltZS1odG1sJztcbmltcG9ydCB7IGNyZWF0ZU1hcHBlZEVycm9yLCBFcnJvck5hbWVzIH0gZnJvbSAnLi9lcnJvcnMnO1xuXG4vKipcbiAqIFdhbGsgdXAgdGhlIERPTSB0cmVlIGFuZCBkZXRlcm1pbmUgd2hhdCBlbGVtZW50IHdpbGwgYmUgc2Nyb2xsZXIgZm9yIGFuIGVsZW1lbnRcbiAqXG4gKiBJZiBub25lIGlzIGZvdW5kLCByZXR1cm4gYGRvY3VtZW50LmRvY3VtZW50RWxlbWVudGBcbiAqL1xuZXhwb3J0IGNvbnN0IGdldFNjcm9sbGVyRWxlbWVudCA9IChlbGVtZW50OiBOb2RlLCBvcmllbnRhdGlvbjogJ3ZlcnRpY2FsJyB8ICdob3Jpem9udGFsJyk6IEhUTUxFbGVtZW50ID0+IHtcbiAgbGV0IGN1cnJlbnQgPSBlbGVtZW50LnBhcmVudE5vZGUgYXMgRWxlbWVudDtcbiAgd2hpbGUgKGN1cnJlbnQgIT09IG51bGwgJiYgY3VycmVudCAhPT0gZG9jdW1lbnQuYm9keSkge1xuICAgIGlmIChoYXNPdmVyZmxvd1Njcm9sbChjdXJyZW50LCBvcmllbnRhdGlvbikpIHtcbiAgICAgIHJldHVybiBjdXJyZW50IGFzIEhUTUxFbGVtZW50O1xuICAgIH1cbiAgICBjdXJyZW50ID0gY3VycmVudC5wYXJlbnROb2RlIGFzIEhUTUxFbGVtZW50O1xuICB9XG4gIHRocm93IGNyZWF0ZU1hcHBlZEVycm9yKEVycm9yTmFtZXMuc2Nyb2xsZXJfZWxlbWVudF9ub3RfZm91bmQpO1xufTtcblxuLyoqXG4gKiBEZXRlcm1pbmUgcmVhbCBkaXN0YW5jZSBvZiBhbiBlbGVtZW50IHRvIHRvcCBvZiBjdXJyZW50IGRvY3VtZW50XG4gKi9cbmV4cG9ydCBjb25zdCBnZXRFbGVtZW50RGlzdGFuY2VUb1RvcE9mRG9jdW1lbnQgPSAoZWxlbWVudDogRWxlbWVudCk6IG51bWJlciA9PiB7XG4gIGNvbnN0IGJveCA9IGVsZW1lbnQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIGNvbnN0IHNjcm9sbFRvcCA9IHdpbmRvdy5wYWdlWU9mZnNldDtcbiAgY29uc3QgY2xpZW50VG9wID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmNsaWVudFRvcDtcbiAgY29uc3QgdG9wID0gYm94LnRvcCArIHNjcm9sbFRvcCAtIGNsaWVudFRvcDtcbiAgcmV0dXJuIE1hdGgucm91bmQodG9wKTtcbn07XG5cbi8qKlxuICogQ2hlY2sgaWYgYW4gZWxlbWVudCBoYXMgc3R5bGUgc2Nyb2xsL2F1dG8gZm9yIG92ZXJmbG93L292ZXJmbG93WVxuICovXG5leHBvcnQgY29uc3QgaGFzT3ZlcmZsb3dTY3JvbGwgPSAoZWxlbWVudDogRWxlbWVudCwgb3JpZW50YXRpb246ICd2ZXJ0aWNhbCcgfCAnaG9yaXpvbnRhbCcpOiBib29sZWFuID0+IHtcbiAgY29uc3Qgc3R5bGUgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShlbGVtZW50KTtcbiAgaWYgKG9yaWVudGF0aW9uID09PSAndmVydGljYWwnKSB7XG4gICAgcmV0dXJuIHN0eWxlICE9IG51bGwgJiYgKHN0eWxlLm92ZXJmbG93WSA9PT0gJ3Njcm9sbCcgfHwgc3R5bGUub3ZlcmZsb3cgPT09ICdzY3JvbGwnIHx8IHN0eWxlLm92ZXJmbG93WSA9PT0gJ2F1dG8nIHx8IHN0eWxlLm92ZXJmbG93ID09PSAnYXV0bycpO1xuICB9XG4gIHJldHVybiBzdHlsZSAhPSBudWxsICYmIChzdHlsZS5vdmVyZmxvd1ggPT09ICdzY3JvbGwnIHx8IHN0eWxlLm92ZXJmbG93ID09PSAnc2Nyb2xsJyB8fCBzdHlsZS5vdmVyZmxvd1ggPT09ICdhdXRvJyB8fCBzdHlsZS5vdmVyZmxvdyA9PT0gJ2F1dG8nKTtcbn07XG5cbi8qKlxuICogR2V0IHRvdGFsIHZhbHVlIG9mIGEgbGlzdCBvZiBjc3Mgc3R5bGUgcHJvcGVydHkgb24gYW4gZWxlbWVudFxuICovXG5leHBvcnQgY29uc3QgZ2V0U3R5bGVWYWx1ZXMgPSAoZWxlbWVudDogRWxlbWVudCwgLi4uc3R5bGVzOiAoa2V5b2YgQ1NTU3R5bGVEZWNsYXJhdGlvbilbXSk6IG51bWJlciA9PiB7XG4gIGNvbnN0IGN1cnJlbnRTdHlsZSA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGVsZW1lbnQpO1xuICBsZXQgdmFsdWU6IG51bWJlciA9IDA7XG4gIGxldCBzdHlsZVZhbHVlOiBudW1iZXIgPSAwO1xuICBmb3IgKGxldCBpID0gMCwgaWkgPSBzdHlsZXMubGVuZ3RoOyBpaSA+IGk7ICsraSkge1xuICAgIHN0eWxlVmFsdWUgPSBwYXJzZUZsb2F0KGN1cnJlbnRTdHlsZVtzdHlsZXNbaV1dIGFzIHN0cmluZyk7XG4gICAgdmFsdWUgKz0gaXNOYU4oc3R5bGVWYWx1ZSkgPyAwIDogc3R5bGVWYWx1ZTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59O1xuXG5leHBvcnQgY29uc3QgY2FsY091dGVySGVpZ2h0ID0gKGVsZW1lbnQ6IEVsZW1lbnQpOiBudW1iZXIgPT4ge1xuICBsZXQgaGVpZ2h0ID0gZWxlbWVudC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS5oZWlnaHQ7XG4gIGhlaWdodCArPSBnZXRTdHlsZVZhbHVlcyhlbGVtZW50LCAnbWFyZ2luVG9wJywgJ21hcmdpbkJvdHRvbScpO1xuICByZXR1cm4gaGVpZ2h0O1xufTtcblxuZXhwb3J0IGNvbnN0IGNhbGNPdXRlcldpZHRoID0gKGVsZW1lbnQ6IEVsZW1lbnQpOiBudW1iZXIgPT4ge1xuICBsZXQgd2lkdGggPSBlbGVtZW50LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLndpZHRoO1xuICB3aWR0aCArPSBnZXRTdHlsZVZhbHVlcyhlbGVtZW50LCAnbWFyZ2luTGVmdCcsICdtYXJnaW5SaWdodCcpO1xuICByZXR1cm4gd2lkdGg7XG59O1xuXG5leHBvcnQgY29uc3QgY2FsY1Njcm9sbGVyVmlld3BvcnRIZWlnaHQgPSAoZWxlbWVudDogRWxlbWVudCk6IG51bWJlciA9PiB7XG4gIGxldCBoZWlnaHQgPSBlbGVtZW50LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLmhlaWdodDtcbiAgaGVpZ2h0IC09IGdldFN0eWxlVmFsdWVzKGVsZW1lbnQsICdib3JkZXJUb3BXaWR0aCcsICdib3JkZXJCb3R0b21XaWR0aCcsICdwYWRkaW5nVG9wJywgJ3BhZGRpbmdCb3R0b20nKTtcbiAgcmV0dXJuIGhlaWdodDtcbn07XG5cbmV4cG9ydCBjb25zdCBjYWxjU2Nyb2xsZXJWaWV3cG9ydFdpZHRoID0gKGVsZW1lbnQ6IEVsZW1lbnQpOiBudW1iZXIgPT4ge1xuICBsZXQgd2lkdGggPSBlbGVtZW50LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLndpZHRoO1xuICB3aWR0aCAtPSBnZXRTdHlsZVZhbHVlcyhlbGVtZW50LCAnYm9yZGVyTGVmdFdpZHRoJywgJ2JvcmRlclJpZ2h0V2lkdGgnLCAncGFkZGluZ0xlZnQnLCAncGFkZGluZ1JpZ2h0Jyk7XG4gIHJldHVybiB3aWR0aDtcbn07XG5cbmV4cG9ydCBjb25zdCBpbnNlcnRCZWZvcmVOb2RlID0gKHZpZXc6IElTeW50aGV0aWNWaWV3LCBib3R0b21CdWZmZXI6IEVsZW1lbnQpOiB2b2lkID0+IHtcbiAgLy8gdG9kbzogYWNjb3VudCBmb3IgYW5jaG9yIGNvbW1lbnRcbiAgdmlldy5ub2Rlcy5pbnNlcnRCZWZvcmUoYm90dG9tQnVmZmVyKTtcbiAgLy8gYm90dG9tQnVmZmVyLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHZpZXcubm9kZXMubGFzdENoaWxkLCBib3R0b21CdWZmZXIpO1xufTtcblxuLyoqXG4gKiBBIG5haXZlIHV0aWxpdHkgdG8gY2FsY3VsYXRlIGRpc3RhbmNlIG9mIGEgY2hpbGQgZWxlbWVudCB0byBvbmUgb2YgaXRzIGFuY2VzdG9yLCB0eXBpY2FsbHkgdXNlZCBmb3Igc2Nyb2xsZXIvYnVmZmVyIGNvbWJvXG4gKiBDYWxjdWxhdGlvbiBpcyBkb25lIGJhc2VkIG9uIG9mZnNldFRvcCwgd2l0aCBmb3JtdWxhOlxuICogY2hpbGQub2Zmc2V0VG9wIC0gcGFyZW50Lm9mZnNldFRvcFxuICogVGhlcmUgYXJlIHN0ZXBzIGluIHRoZSBtaWRkbGUgdG8gYWNjb3VudCBmb3Igb2Zmc2V0UGFyZW50IGJ1dCBpdCdzIGJhc2ljYWxseSB0aGF0XG4gKi9cbmV4cG9ydCBjb25zdCBnZXREaXN0YW5jZVRvU2Nyb2xsZXIgPSAoY2hpbGQ6IEhUTUxFbGVtZW50LCBzY3JvbGxlcjogSFRNTEVsZW1lbnQpOiBudW1iZXIgPT4ge1xuICBjb25zdCBvZmZzZXRQYXJlbnQgPSBjaGlsZC5vZmZzZXRQYXJlbnQgYXMgSFRNTEVsZW1lbnQ7XG4gIGNvbnN0IGNoaWxkT2Zmc2V0VG9wID0gY2hpbGQub2Zmc2V0VG9wO1xuICAvLyBbZWxdIDwtLSBvZmZzZXQgcGFyZW50ID09PSBwYXJlbnRcbiAgLy8gIC4uLlxuICAvLyAgIFtlbF0gPC0tIGNoaWxkXG4gIGlmIChvZmZzZXRQYXJlbnQgPT09IG51bGwgfHwgb2Zmc2V0UGFyZW50ID09PSBzY3JvbGxlcikge1xuICAgIHJldHVybiBjaGlsZE9mZnNldFRvcDtcbiAgfVxuXG4gIC8vIFtlbF0gPC0tIG9mZnNldCBwYXJlbnRcbiAgLy8gICBbZWxdIDwtLSBwYXJlbnRcbiAgLy8gICAgIFtlbF0gPC0tIGNoaWxkXG4gIGlmIChvZmZzZXRQYXJlbnQuY29udGFpbnMoc2Nyb2xsZXIpKSB7XG4gICAgcmV0dXJuIGNoaWxkT2Zmc2V0VG9wIC0gc2Nyb2xsZXIub2Zmc2V0VG9wO1xuICB9XG5cbiAgLy8gW2VsXSA8LS0gcGFyZW50XG4gIC8vICAgW2VsXSA8LS0gb2Zmc2V0IHBhcmVudFxuICAvLyAgICAgW2VsXSA8LS0gY2hpbGRcbiAgcmV0dXJuIGNoaWxkT2Zmc2V0VG9wICsgZ2V0RGlzdGFuY2VUb1Njcm9sbGVyKG9mZnNldFBhcmVudCwgc2Nyb2xsZXIpO1xufTtcblxuLyoqXG4gKiBBIG5haXZlIHV0aWxpdHkgdG8gY2FsY3VsYXRlIGhvcml6b250YWwgZGlzdGFuY2Ugb2YgYSBjaGlsZCBlbGVtZW50IHRvIG9uZSBvZiBpdHMgYW5jZXN0b3JcbiAqIFNpbWlsYXIgdG8gZ2V0RGlzdGFuY2VUb1Njcm9sbGVyIGJ1dCBmb3IgaG9yaXpvbnRhbCBwb3NpdGlvbmluZ1xuICovXG5leHBvcnQgY29uc3QgZ2V0SG9yaXpvbnRhbERpc3RhbmNlVG9TY3JvbGxlciA9IChjaGlsZDogSFRNTEVsZW1lbnQsIHNjcm9sbGVyOiBIVE1MRWxlbWVudCk6IG51bWJlciA9PiB7XG4gIGNvbnN0IG9mZnNldFBhcmVudCA9IGNoaWxkLm9mZnNldFBhcmVudCBhcyBIVE1MRWxlbWVudDtcbiAgY29uc3QgY2hpbGRPZmZzZXRMZWZ0ID0gY2hpbGQub2Zmc2V0TGVmdDtcblxuICBpZiAob2Zmc2V0UGFyZW50ID09PSBudWxsIHx8IG9mZnNldFBhcmVudCA9PT0gc2Nyb2xsZXIpIHtcbiAgICByZXR1cm4gY2hpbGRPZmZzZXRMZWZ0O1xuICB9XG5cbiAgaWYgKG9mZnNldFBhcmVudC5jb250YWlucyhzY3JvbGxlcikpIHtcbiAgICByZXR1cm4gY2hpbGRPZmZzZXRMZWZ0IC0gc2Nyb2xsZXIub2Zmc2V0TGVmdDtcbiAgfVxuXG4gIHJldHVybiBjaGlsZE9mZnNldExlZnQgKyBnZXRIb3Jpem9udGFsRGlzdGFuY2VUb1Njcm9sbGVyKG9mZnNldFBhcmVudCwgc2Nyb2xsZXIpO1xufTtcbiIsImltcG9ydCB7IHJlc29sdmUgfSBmcm9tIFwiQGF1cmVsaWEva2VybmVsXCI7XG5pbXBvcnQgeyB0eXBlIElzQmluZGluZ0JlaGF2aW9yLCBGb3JPZlN0YXRlbWVudCwgQmluZGluZ0lkZW50aWZpZXIgfSBmcm9tICdAYXVyZWxpYS9leHByZXNzaW9uLXBhcnNlcic7XG5pbXBvcnQge1xuICBDb2xsZWN0aW9uLFxuICBnZXRDb2xsZWN0aW9uT2JzZXJ2ZXIsXG4gIEluZGV4TWFwLFxuICBTY29wZSxcbiAgdHlwZSBJT3ZlcnJpZGVDb250ZXh0LFxuICBCaW5kaW5nQ29udGV4dCxcbiAgYXN0RXZhbHVhdGUsXG4gIHF1ZXVlQXN5bmNUYXNrLFxuICBUYXNrLFxufSBmcm9tICdAYXVyZWxpYS9ydW50aW1lJztcbmltcG9ydCB7XG4gIElDb250cm9sbGVyLFxuICBJVmlld0ZhY3RvcnksXG4gIElIeWRyYXRlZENvbXBvbmVudENvbnRyb2xsZXIsXG4gIElDdXN0b21BdHRyaWJ1dGVWaWV3TW9kZWwsXG4gIElTeW50aGV0aWNWaWV3LFxuICBJUmVuZGVyTG9jYXRpb24sXG4gIHR5cGUgQ3VzdG9tQXR0cmlidXRlU3RhdGljQXVEZWZpbml0aW9uLFxuICBJUGxhdGZvcm0sXG59IGZyb20gJ0BhdXJlbGlhL3J1bnRpbWUtaHRtbCc7XG5pbXBvcnQge1xuICBJSW5zdHJ1Y3Rpb24sXG4gIEh5ZHJhdGVUZW1wbGF0ZUNvbnRyb2xsZXIsXG4gIEl0ZXJhdG9yQmluZGluZ0luc3RydWN0aW9uLFxufSBmcm9tICdAYXVyZWxpYS90ZW1wbGF0ZS1jb21waWxlcic7XG5pbXBvcnQge1xuICB1bndyYXBFeHByZXNzaW9uLFxufSBmcm9tIFwiLi91dGlsaXRpZXMtcmVwZWF0XCI7XG5pbXBvcnQgeyBjcmVhdGVNYXBwZWRFcnJvciwgRXJyb3JOYW1lcyB9IGZyb20gJy4vZXJyb3JzJztcbmltcG9ydCB7XG4gIElDb2xsZWN0aW9uU3RyYXRlZ3lMb2NhdG9yLFxuICBJRG9tUmVuZGVyZXIsXG4gIFZJUlRVQUxfUkVQRUFUX05FQVJfQk9UVE9NLFxuICBWSVJUVUFMX1JFUEVBVF9ORUFSX1RPUCxcbn0gZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHR5cGUge1xuICBJQ29sbGVjdGlvblN0cmF0ZWd5LFxuICBJVmlydHVhbFJlcGVhdERvbSxcbiAgSVZpcnR1YWxSZXBlYXRlclxufSBmcm9tIFwiLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQge1xuICBjYWxjT3V0ZXJIZWlnaHQsXG4gIGNhbGNPdXRlcldpZHRoLFxuICBjYWxjU2Nyb2xsZXJWaWV3cG9ydEhlaWdodCxcbiAgY2FsY1Njcm9sbGVyVmlld3BvcnRXaWR0aCxcbiAgZ2V0RGlzdGFuY2VUb1Njcm9sbGVyLFxuICBnZXRIb3Jpem9udGFsRGlzdGFuY2VUb1Njcm9sbGVyXG59IGZyb20gXCIuL3V0aWxpdGllcy1kb21cIjtcblxuZXhwb3J0IGludGVyZmFjZSBWaXJ0dWFsUmVwZWF0IGV4dGVuZHMgSUN1c3RvbUF0dHJpYnV0ZVZpZXdNb2RlbCB7IH1cblxuZXhwb3J0IGNsYXNzIFZpcnR1YWxSZXBlYXQgaW1wbGVtZW50cyBJVmlydHVhbFJlcGVhdGVyIHtcbiAgcHVibGljIHN0YXRpYyByZWFkb25seSAkYXU6IEN1c3RvbUF0dHJpYnV0ZVN0YXRpY0F1RGVmaW5pdGlvbiA9IHtcbiAgICB0eXBlOiAnY3VzdG9tLWF0dHJpYnV0ZScsXG4gICAgbmFtZTogJ3ZpcnR1YWwtcmVwZWF0JyxcbiAgICBpc1RlbXBsYXRlQ29udHJvbGxlcjogdHJ1ZSxcbiAgICBiaW5kYWJsZXM6IHtcbiAgICAgIGxvY2FsOiB0cnVlLFxuICAgICAgaXRlbXM6IHsgcHJpbWFyeTogdHJ1ZSB9XG4gICAgfVxuICB9O1xuXG4gIC8vIGJpbmRhYmxlXG4gIHB1YmxpYyBsb2NhbDogc3RyaW5nO1xuXG4gIC8vIGJpbmRhYmxlXG4gIHB1YmxpYyBpdGVtczogQ29sbGVjdGlvbiB8IG51bGwgfCB1bmRlZmluZWQgPSB2b2lkIDA7XG5cbiAgLyoqIEBpbnRlcm5hbCAqLyBwcml2YXRlIHJlYWRvbmx5IGl0ZXJhYmxlOiBJc0JpbmRpbmdCZWhhdmlvcjtcbiAgLy8gLyoqIEBpbnRlcm5hbCAqLyBwcml2YXRlIHJlYWRvbmx5IGZvck9mOiBGb3JPZlN0YXRlbWVudDtcbiAgLyoqIEBpbnRlcm5hbCAqLyBwcml2YXRlIHJlYWRvbmx5IF9oYXNXcmFwRXhwcmVzc2lvbjogYm9vbGVhbjtcbiAgLyoqIEBpbnRlcm5hbCAqLyBwcml2YXRlIHJlYWRvbmx5IF9vYnNNZWRpYXRvcjogQ29sbGVjdGlvbk9ic2VydmF0aW9uTWVkaWF0b3I7XG5cbiAgLyoqIEBpbnRlcm5hbCAqLyBwcml2YXRlIHJlYWRvbmx5IHZpZXdzOiBJU3ludGhldGljVmlld1tdID0gW107XG4gIC8qKiBAaW50ZXJuYWwgKi8gcHJpdmF0ZSB0YXNrOiBUYXNrIHwgbnVsbCA9IG51bGw7XG5cbiAgcHJpdmF0ZSBpdGVtSGVpZ2h0ID0gMDtcbiAgcHJpdmF0ZSBpdGVtV2lkdGggPSAwO1xuICBwcml2YXRlIG1pblZpZXdzUmVxdWlyZWQgPSAwO1xuICBwcml2YXRlIGNvbGxlY3Rpb25TdHJhdGVneT86IElDb2xsZWN0aW9uU3RyYXRlZ3k7XG4gIHByaXZhdGUgZG9tOiBJVmlydHVhbFJlcGVhdERvbSA9IG51bGwhO1xuXG4gIC8qKiBAaW50ZXJuYWwgKi8gcHJpdmF0ZSByZWFkb25seSBfY29uZmlndXJlZEl0ZW1IZWlnaHQ/OiBudW1iZXI7XG4gIC8qKiBAaW50ZXJuYWwgKi8gcHJpdmF0ZSByZWFkb25seSBfY29uZmlndXJlZEl0ZW1XaWR0aD86IG51bWJlcjtcbiAgLyoqIEBpbnRlcm5hbCAqLyBwcml2YXRlIHJlYWRvbmx5IF9jb25maWd1cmVkQnVmZmVyU2l6ZT86IG51bWJlcjtcbiAgLyoqIEBpbnRlcm5hbCAqLyBwcml2YXRlIHJlYWRvbmx5IF9jb25maWd1cmVkTWluVmlld3M/OiBudW1iZXI7XG4gIC8qKiBAaW50ZXJuYWwgKi8gcHJpdmF0ZSByZWFkb25seSBfY29uZmlndXJlZExheW91dDogJ3ZlcnRpY2FsJyB8ICdob3Jpem9udGFsJyA9ICd2ZXJ0aWNhbCc7XG4gIC8qKiBAaW50ZXJuYWwgKi8gcHJpdmF0ZSByZWFkb25seSBfY29uZmlndXJlZFZhcmlhYmxlSGVpZ2h0OiBib29sZWFuID0gZmFsc2U7XG4gIC8qKiBAaW50ZXJuYWwgKi8gcHJpdmF0ZSByZWFkb25seSBfY29uZmlndXJlZFZhcmlhYmxlV2lkdGg6IGJvb2xlYW4gPSBmYWxzZTtcblxuICAvLyBWYXJpYWJsZSBzaXppbmcgc3VwcG9ydFxuICAvKiogQGludGVybmFsICovIHByaXZhdGUgcmVhZG9ubHkgX2l0ZW1IZWlnaHRzOiBudW1iZXJbXSA9IFtdO1xuICAvKiogQGludGVybmFsICovIHByaXZhdGUgcmVhZG9ubHkgX2l0ZW1XaWR0aHM6IG51bWJlcltdID0gW107XG4gIC8qKiBAaW50ZXJuYWwgKi8gcHJpdmF0ZSBfY3VtdWxhdGl2ZUhlaWdodHM6IG51bWJlcltdID0gW107XG4gIC8qKiBAaW50ZXJuYWwgKi8gcHJpdmF0ZSBfY3VtdWxhdGl2ZVdpZHRoczogbnVtYmVyW10gPSBbXTtcblxuICBwdWJsaWMgcmVhZG9ubHkgbG9jYXRpb24gPSByZXNvbHZlKElSZW5kZXJMb2NhdGlvbik7XG4gIHB1YmxpYyByZWFkb25seSBpbnN0cnVjdGlvbiA9IHJlc29sdmUoSUluc3RydWN0aW9uKSBhcyBIeWRyYXRlVGVtcGxhdGVDb250cm9sbGVyO1xuICBwdWJsaWMgcmVhZG9ubHkgcGFyZW50ID0gcmVzb2x2ZShJQ29udHJvbGxlcikgYXMgSUh5ZHJhdGVkQ29tcG9uZW50Q29udHJvbGxlcjtcbiAgLyoqIEBpbnRlcm5hbCAqLyBwcml2YXRlIHJlYWRvbmx5IF9mYWN0b3J5ID0gcmVzb2x2ZShJVmlld0ZhY3RvcnkpO1xuICAvKiogQGludGVybmFsICovIHByaXZhdGUgcmVhZG9ubHkgX3N0cmF0ZWd5TG9jYXRvciA9IHJlc29sdmUoSUNvbGxlY3Rpb25TdHJhdGVneUxvY2F0b3IpO1xuICAvKiogQGludGVybmFsICovIHByaXZhdGUgcmVhZG9ubHkgX2RvbVJlbmRlcmVyID0gcmVzb2x2ZShJRG9tUmVuZGVyZXIpO1xuXG4gIHB1YmxpYyBjb25zdHJ1Y3RvcigpIHtcbiAgICBjb25zdCBpdGVyYXRvckluc3RydWN0aW9uID0gdGhpcy5pbnN0cnVjdGlvbi5wcm9wc1swXSBhcyBJdGVyYXRvckJpbmRpbmdJbnN0cnVjdGlvbjtcbiAgICBjb25zdCBmb3JPZiA9IGl0ZXJhdG9ySW5zdHJ1Y3Rpb24uZm9yT2YgYXMgRm9yT2ZTdGF0ZW1lbnQ7XG4gICAgY29uc3QgaXRlcmFibGUgPSB0aGlzLml0ZXJhYmxlID0gdW53cmFwRXhwcmVzc2lvbihmb3JPZi5pdGVyYWJsZSkgPz8gZm9yT2YuaXRlcmFibGU7XG4gICAgY29uc3QgaGFzV3JhcEV4cHJlc3Npb24gPSB0aGlzLl9oYXNXcmFwRXhwcmVzc2lvbiA9IGZvck9mLml0ZXJhYmxlICE9PSBpdGVyYWJsZTtcbiAgICB0aGlzLl9vYnNNZWRpYXRvciA9IG5ldyBDb2xsZWN0aW9uT2JzZXJ2YXRpb25NZWRpYXRvcih0aGlzLCAoKSA9PiBoYXNXcmFwRXhwcmVzc2lvbiA/IHRoaXMuX2hhbmRsZUlubmVyQ29sbGVjdGlvbkNoYW5nZSgpIDogdGhpcy5faGFuZGxlQ29sbGVjdGlvbkNoYW5nZSgpKTtcbiAgICB0aGlzLmxvY2FsID0gKGZvck9mLmRlY2xhcmF0aW9uIGFzIEJpbmRpbmdJZGVudGlmaWVyKS5uYW1lO1xuXG4gICAgY29uc3QgZXh0cmFQcm9wcyA9IChpdGVyYXRvckluc3RydWN0aW9uLnByb3BzID8/IFtdKTtcbiAgICBmb3IgKGNvbnN0IHAgb2YgZXh0cmFQcm9wcykge1xuICAgICAgaWYgKHAgPT0gbnVsbCkgY29udGludWU7XG4gICAgICAvLyBDb21iaW5lIHRoZSBwcmltYXJ5IHBhaXIgKHAudG8gOiBwLnZhbHVlKSBhbmQgYW55IGFkZGl0aW9uYWwgcGFpcnMgZW1iZWRkZWQgaW4gdmFsdWVcbiAgICAgIGNvbnN0IGluaXRpYWxUZXh0ID0gYCR7cC50b306JHtwLnZhbHVlfWA7XG4gICAgICBjb25zdCBwYWlycyA9IGluaXRpYWxUZXh0LnNwbGl0KCc7Jyk7XG4gICAgICBmb3IgKGNvbnN0IHBhaXIgb2YgcGFpcnMpIHtcbiAgICAgICAgY29uc3QgW3Jhd0tleSwgcmF3VmFsXSA9IHBhaXIuc3BsaXQoJzonKTtcbiAgICAgICAgaWYgKCFyYXdLZXkgfHwgcmF3VmFsID09PSB2b2lkIDApIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBrZXkgPSByYXdLZXkudHJpbSgpO1xuICAgICAgICBjb25zdCB2YWx1ZVN0ciA9IHJhd1ZhbC50cmltKCk7XG4gICAgICAgIGNvbnN0IHZhbE51bSA9IE51bWJlcih2YWx1ZVN0cik7XG4gICAgICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICAgICAgY2FzZSAnaXRlbUhlaWdodCc6XG4gICAgICAgICAgY2FzZSAnaXRlbS1oZWlnaHQnOiB7XG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih2YWxOdW0pICYmIHZhbE51bSA+IDApIHtcbiAgICAgICAgICAgICAgdGhpcy5fY29uZmlndXJlZEl0ZW1IZWlnaHQgPSB2YWxOdW07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgY2FzZSAnaXRlbVdpZHRoJzpcbiAgICAgICAgICBjYXNlICdpdGVtLXdpZHRoJzoge1xuICAgICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4odmFsTnVtKSAmJiB2YWxOdW0gPiAwKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2NvbmZpZ3VyZWRJdGVtV2lkdGggPSB2YWxOdW07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgY2FzZSAnYnVmZmVyU2l6ZSc6XG4gICAgICAgICAgY2FzZSAnYnVmZmVyLXNpemUnOiB7XG4gICAgICAgICAgICBpZiAoIU51bWJlci5pc05hTih2YWxOdW0pICYmIHZhbE51bSA+IDApIHtcbiAgICAgICAgICAgICAgdGhpcy5fY29uZmlndXJlZEJ1ZmZlclNpemUgPSB2YWxOdW07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgY2FzZSAnbWluVmlld3MnOlxuICAgICAgICAgIGNhc2UgJ21pbi12aWV3cyc6IHtcbiAgICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHZhbE51bSkgJiYgdmFsTnVtID4gMCkge1xuICAgICAgICAgICAgICB0aGlzLl9jb25maWd1cmVkTWluVmlld3MgPSB2YWxOdW07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgY2FzZSAnbGF5b3V0Jzoge1xuICAgICAgICAgICAgaWYgKHZhbHVlU3RyID09PSAnaG9yaXpvbnRhbCcgfHwgdmFsdWVTdHIgPT09ICd2ZXJ0aWNhbCcpIHtcbiAgICAgICAgICAgICAgdGhpcy5fY29uZmlndXJlZExheW91dCA9IHZhbHVlU3RyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNhc2UgJ3ZhcmlhYmxlSGVpZ2h0JzpcbiAgICAgICAgICBjYXNlICd2YXJpYWJsZS1oZWlnaHQnOiB7XG4gICAgICAgICAgICBpZiAodmFsdWVTdHIgPT09ICd0cnVlJyB8fCB2YWx1ZVN0ciA9PT0gJzEnKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2NvbmZpZ3VyZWRWYXJpYWJsZUhlaWdodCA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgY2FzZSAndmFyaWFibGVXaWR0aCc6XG4gICAgICAgICAgY2FzZSAndmFyaWFibGUtd2lkdGgnOiB7XG4gICAgICAgICAgICBpZiAodmFsdWVTdHIgPT09ICd0cnVlJyB8fCB2YWx1ZVN0ciA9PT0gJzEnKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2NvbmZpZ3VyZWRWYXJpYWJsZVdpZHRoID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgLy8gaWdub3JlIHVua25vd24ga2V5c1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKiogQGludGVybmFsICovXG4gIHByaXZhdGUgX3Vuc3Vic2NyaWJlU2Nyb2xsZXI6ICgoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZDtcbiAgLyoqIEBpbnRlcm5hbCAqL1xuICBwcml2YXRlIF9hdHRhY2hlZCA9IGZhbHNlO1xuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwdWJsaWMgYXR0YWNoaW5nKCk6IHZvaWQge1xuICAgIHRoaXMuZG9tID0gdGhpcy5fZG9tUmVuZGVyZXIucmVuZGVyKHRoaXMubG9jYXRpb24sIHRoaXMuX2NvbmZpZ3VyZWRMYXlvdXQpO1xuICAgIGNvbnN0IHBhcmVudFRhZyA9ICh0aGlzLmRvbS5hbmNob3IucGFyZW50Tm9kZSBhcyBFbGVtZW50KS50YWdOYW1lO1xuICAgIGlmICh0aGlzLl9jb25maWd1cmVkTGF5b3V0ID09PSAnaG9yaXpvbnRhbCdcbiAgICAgICAgJiYgKHBhcmVudFRhZyA9PT0gJ1RCT0RZJyB8fCBwYXJlbnRUYWcgPT09ICdUSEVBRCcgfHwgcGFyZW50VGFnID09PSAnVEZPT1QnIHx8IHBhcmVudFRhZyA9PT0gJ1RBQkxFJykpIHtcbiAgICAgIHRocm93IGNyZWF0ZU1hcHBlZEVycm9yKEVycm9yTmFtZXMudmlydHVhbF9yZXBlYXRfaG9yaXpvbnRhbF9pbl90YWJsZSk7XG4gICAgfVxuICAgIHRoaXMuX29ic01lZGlhdG9yLnN0YXJ0KHRoaXMuaXRlbXMpO1xuICAgIHRoaXMuY29sbGVjdGlvblN0cmF0ZWd5ID0gdGhpcy5fc3RyYXRlZ3lMb2NhdG9yLmdldFN0cmF0ZWd5KHRoaXMuaXRlbXMpO1xuICAgIHRoaXMuX3Vuc3Vic2NyaWJlU2Nyb2xsZXIgPSB0aGlzLl9vYnNlcnZlU2Nyb2xsZXIoKTtcbiAgICB0aGlzLl9hdHRhY2hlZCA9IHRydWU7XG4gICAgdGhpcy5fb25SZXNpemUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyBkZXRhY2hpbmcoKSB7XG4gICAgdGhpcy5fYXR0YWNoZWQgPSBmYWxzZTtcbiAgICB0aGlzLl91bnN1YnNjcmliZVNjcm9sbGVyPy4oKTtcbiAgICB0aGlzLnRhc2s/LmNhbmNlbCgpO1xuICAgIHRoaXMuX3Jlc2V0Q2FsY3VsYXRpb24oKTtcbiAgICB0aGlzLmRvbS5kaXNwb3NlKCk7XG4gICAgdGhpcy5fb2JzTWVkaWF0b3Iuc3RvcCgpO1xuXG4gICAgdGhpcy5kb21cbiAgICAgID0gdGhpcy50YXNrXG4gICAgICA9IG51bGwhO1xuICB9XG5cbiAgLyoqIEBpbnRlcm5hbCAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHAgPSByZXNvbHZlKElQbGF0Zm9ybSk7XG4gIC8qKiBAaW50ZXJuYWwgKi9cbiAgcHJpdmF0ZSBfb2JzZXJ2ZVNjcm9sbGVyKCkge1xuICAgIGNvbnN0IHNjcm9sbGVyID0gdGhpcy5kb20uc2Nyb2xsZXI7XG4gICAgY29uc3Qgb2JzID0gbmV3IHRoaXMucC53aW5kb3cuUmVzaXplT2JzZXJ2ZXIoKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLl9hdHRhY2hlZCkgcmV0dXJuO1xuICAgICAgdGhpcy5fb25SZXNpemUoKTtcbiAgICB9KTtcbiAgICBjb25zdCBoYW5kbGVTY3JvbGwgPSAoKSA9PiB0aGlzLmhhbmRsZVNjcm9sbChzY3JvbGxlcik7XG5cbiAgICBvYnMub2JzZXJ2ZShzY3JvbGxlcik7XG4gICAgc2Nyb2xsZXIuYWRkRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlU2Nyb2xsKTtcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBvYnMuZGlzY29ubmVjdCgpO1xuICAgICAgLy8gdGhpcy5fb2JzLnVub2JzZXJ2ZShzY3JvbGxlcik7XG4gICAgICBzY3JvbGxlci5yZW1vdmVFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVTY3JvbGwpO1xuICAgIH07XG4gIH1cblxuICAvKiogQGludGVybmFsICovXG4gIHByaXZhdGUgX29uUmVzaXplKCkge1xuICAgIGNvbnN0IGl0ZW1Db3VudCA9IHRoaXMuY29sbGVjdGlvblN0cmF0ZWd5IS5jb3VudDtcbiAgICBjb25zdCBoYXNJdGVtcyA9IGl0ZW1Db3VudCA+IDA7XG4gICAgaWYgKCFoYXNJdGVtcykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpcnN0VmlldyA9IHRoaXMuX2NyZWF0ZUFuZEFjdGl2YXRlRmlyc3RWaWV3KCk7XG5cbiAgICBjb25zdCBpc0hvcml6b250YWwgPSB0aGlzLl9jb25maWd1cmVkTGF5b3V0ID09PSAnaG9yaXpvbnRhbCc7XG4gICAgY29uc3QgZmlyc3RFbGVtZW50ID0gZmlyc3RWaWV3Lm5vZGVzLmZpcnN0Q2hpbGQgYXMgSFRNTEVsZW1lbnQ7XG4gICAgY29uc3QgaXRlbUhlaWdodCA9IHRoaXMuX2NvbmZpZ3VyZWRJdGVtSGVpZ2h0ID8/IGNhbGNPdXRlckhlaWdodChmaXJzdEVsZW1lbnQpO1xuICAgIGNvbnN0IGl0ZW1XaWR0aCA9IHRoaXMuX2NvbmZpZ3VyZWRJdGVtV2lkdGggPz8gY2FsY091dGVyV2lkdGgoZmlyc3RFbGVtZW50KTtcblxuICAgIGNvbnN0IHNjcm9sbGVyID0gdGhpcy5kb20uc2Nyb2xsZXI7XG4gICAgY29uc3Qgdmlld3BvcnRTaXplID0gaXNIb3Jpem9udGFsXG4gICAgICA/IGNhbGNTY3JvbGxlclZpZXdwb3J0V2lkdGgoc2Nyb2xsZXIpXG4gICAgICA6IGNhbGNTY3JvbGxlclZpZXdwb3J0SGVpZ2h0KHNjcm9sbGVyKTtcbiAgICBjb25zdCBjYW5TY3JvbGwgPSAoKSA9PiBpc0hvcml6b250YWxcbiAgICAgID8gc2Nyb2xsZXIuc2Nyb2xsV2lkdGggPiB2aWV3cG9ydFNpemVcbiAgICAgIDogc2Nyb2xsZXIuc2Nyb2xsSGVpZ2h0ID4gdmlld3BvcnRTaXplO1xuXG4gICAgaWYgKCFjYW5TY3JvbGwoKSkge1xuICAgICAgY29uc3Qgdmlld0NvdW50ID0gdGhpcy52aWV3cy5sZW5ndGg7XG4gICAgICAvLyB3aGVuIHVwZGF0aW5nIHRoZSBkb21cbiAgICAgIC8vIHdlIHdpbGwgdHJpZ2dlciBhbiBldmVudCBhbmQgdGhlbiBoYW5kbGUgaXQgdGhlIG5leHQgZnJhbWVcbiAgICAgIHRoaXMuZG9tLnVwZGF0ZSgwLCAoaXNIb3Jpem9udGFsID8gaXRlbVdpZHRoIDogaXRlbUhlaWdodCkgKiAoaXRlbUNvdW50IC0gdmlld0NvdW50KSk7XG4gICAgfVxuXG4gICAgdGhpcy5pdGVtSGVpZ2h0ID0gaXRlbUhlaWdodDtcbiAgICB0aGlzLml0ZW1XaWR0aCA9IGl0ZW1XaWR0aDtcblxuICAgIGlmICghY2FuU2Nyb2xsKCkpIHtcbiAgICAgIC8vIGlmIGF0IHRoaXMgcG9pbnQgc3RpbGwgY2Fubm90IHNjcm9sbFxuICAgICAgLy8gdGhlbiBub3Qgc3VyZSB3aGF0IHRvIGRvXG4gICAgICAvLyBqdXN0IHJlbmRlcnMgZXZlcnl0aGluZ1xuICAgICAgdGhpcy5taW5WaWV3c1JlcXVpcmVkID0gaXRlbUNvdW50O1xuICAgICAgcmV0dXJuO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBtaW5WaWV3cyA9IHRoaXMuX2NvbmZpZ3VyZWRNaW5WaWV3cyA/PyB2aWV3cG9ydFNpemUgLyAoaXNIb3Jpem9udGFsID8gaXRlbVdpZHRoIDogaXRlbUhlaWdodCk7XG4gICAgICB0aGlzLm1pblZpZXdzUmVxdWlyZWQgPSBNYXRoLmNlaWwobWluVmlld3MpO1xuXG4gICAgICAvLyBGb3IgdmFyaWFibGUgc2l6aW5nLCBtZWFzdXJlIHRoZSBmaXJzdCBpdGVtIHRvIGluaXRpYWxpemUgdGhlIGFycmF5c1xuICAgICAgaWYgKChpc0hvcml6b250YWwgJiYgdGhpcy5fY29uZmlndXJlZFZhcmlhYmxlV2lkdGgpIHx8ICghaXNIb3Jpem9udGFsICYmIHRoaXMuX2NvbmZpZ3VyZWRWYXJpYWJsZUhlaWdodCkpIHtcbiAgICAgICAgdGhpcy5fbWVhc3VyZUFuZFN0b3JlSXRlbVNpemUoZmlyc3RWaWV3LCAwKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9oYW5kbGVJdGVtc0NoYW5nZWQodGhpcy5pdGVtcywgdGhpcy5jb2xsZWN0aW9uU3RyYXRlZ3khKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHByaXZhdGUgX3Jlc2V0Q2FsY3VsYXRpb24oKSB7XG4gICAgdGhpcy5taW5WaWV3c1JlcXVpcmVkID0gMDtcbiAgICB0aGlzLml0ZW1IZWlnaHQgPSAwO1xuICAgIHRoaXMuaXRlbVdpZHRoID0gMDtcbiAgICB0aGlzLmRvbS51cGRhdGUoMCwgMCk7XG5cbiAgICAvLyBSZXNldCB2YXJpYWJsZSBzaXppbmcgZGF0YVxuICAgIHRoaXMuX2l0ZW1IZWlnaHRzLmxlbmd0aCA9IDA7XG4gICAgdGhpcy5faXRlbVdpZHRocy5sZW5ndGggPSAwO1xuICAgIHRoaXMuX2N1bXVsYXRpdmVIZWlnaHRzID0gW107XG4gICAgdGhpcy5fY3VtdWxhdGl2ZVdpZHRocyA9IFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcHJpdmF0ZSBfbWVhc3VyZUFuZFN0b3JlSXRlbVNpemUodmlldzogSVN5bnRoZXRpY1ZpZXcsIGluZGV4OiBudW1iZXIpOiB2b2lkIHtcbiAgICBjb25zdCBlbGVtZW50ID0gdmlldy5ub2Rlcy5maXJzdENoaWxkIGFzIEhUTUxFbGVtZW50O1xuICAgIGlmIChlbGVtZW50ID09IG51bGwpIHJldHVybjtcblxuICAgIGNvbnN0IGhlaWdodCA9IGNhbGNPdXRlckhlaWdodChlbGVtZW50KTtcbiAgICBjb25zdCB3aWR0aCA9IGNhbGNPdXRlcldpZHRoKGVsZW1lbnQpO1xuXG4gICAgLy8gU3RvcmUgdGhlIG1lYXN1cmVkIHNpemVzXG4gICAgdGhpcy5faXRlbUhlaWdodHNbaW5kZXhdID0gaGVpZ2h0O1xuICAgIHRoaXMuX2l0ZW1XaWR0aHNbaW5kZXhdID0gd2lkdGg7XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwcml2YXRlIF9idWlsZEN1bXVsYXRpdmVTaXplcyhpdGVtQ291bnQ6IG51bWJlcik6IHZvaWQge1xuICAgIC8vIEJ1aWxkIGN1bXVsYXRpdmUgaGVpZ2h0c1xuICAgIHRoaXMuX2N1bXVsYXRpdmVIZWlnaHRzID0gbmV3IEFycmF5KGl0ZW1Db3VudCk7XG4gICAgbGV0IGN1bXVsYXRpdmVIZWlnaHQgPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaXRlbUNvdW50OyBpKyspIHtcbiAgICAgIGNvbnN0IGhlaWdodCA9IHRoaXMuX2l0ZW1IZWlnaHRzW2ldID8/IHRoaXMuaXRlbUhlaWdodDtcbiAgICAgIGN1bXVsYXRpdmVIZWlnaHQgKz0gaGVpZ2h0O1xuICAgICAgdGhpcy5fY3VtdWxhdGl2ZUhlaWdodHNbaV0gPSBjdW11bGF0aXZlSGVpZ2h0O1xuICAgIH1cblxuICAgIC8vIEJ1aWxkIGN1bXVsYXRpdmUgd2lkdGhzXG4gICAgdGhpcy5fY3VtdWxhdGl2ZVdpZHRocyA9IG5ldyBBcnJheShpdGVtQ291bnQpO1xuICAgIGxldCBjdW11bGF0aXZlV2lkdGggPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaXRlbUNvdW50OyBpKyspIHtcbiAgICAgIGNvbnN0IHdpZHRoID0gdGhpcy5faXRlbVdpZHRoc1tpXSA/PyB0aGlzLml0ZW1XaWR0aDtcbiAgICAgIGN1bXVsYXRpdmVXaWR0aCArPSB3aWR0aDtcbiAgICAgIHRoaXMuX2N1bXVsYXRpdmVXaWR0aHNbaV0gPSBjdW11bGF0aXZlV2lkdGg7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcHJpdmF0ZSBfZmluZEluZGV4QnlQb3NpdGlvbihwb3NpdGlvbjogbnVtYmVyLCBpc0hvcml6b250YWw6IGJvb2xlYW4pOiBudW1iZXIge1xuICAgIGNvbnN0IGN1bXVsYXRpdmUgPSBpc0hvcml6b250YWwgPyB0aGlzLl9jdW11bGF0aXZlV2lkdGhzIDogdGhpcy5fY3VtdWxhdGl2ZUhlaWdodHM7XG5cbiAgICBpZiAoY3VtdWxhdGl2ZS5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIEZhbGxiYWNrIHRvIGZpeGVkIHNpemluZ1xuICAgICAgY29uc3QgaXRlbVNpemUgPSBpc0hvcml6b250YWwgPyB0aGlzLml0ZW1XaWR0aCA6IHRoaXMuaXRlbUhlaWdodDtcbiAgICAgIHJldHVybiBpdGVtU2l6ZSA+IDAgPyBNYXRoLmZsb29yKHBvc2l0aW9uIC8gaXRlbVNpemUpIDogMDtcbiAgICB9XG5cbiAgICAvLyBCaW5hcnkgc2VhcmNoIHRvIGZpbmQgdGhlIGluZGV4XG4gICAgbGV0IGxlZnQgPSAwO1xuICAgIGxldCByaWdodCA9IGN1bXVsYXRpdmUubGVuZ3RoIC0gMTtcblxuICAgIHdoaWxlIChsZWZ0IDw9IHJpZ2h0KSB7XG4gICAgICBjb25zdCBtaWQgPSBNYXRoLmZsb29yKChsZWZ0ICsgcmlnaHQpIC8gMik7XG4gICAgICBjb25zdCBjdW11bGF0aXZlU2l6ZSA9IGN1bXVsYXRpdmVbbWlkXTtcbiAgICAgIGNvbnN0IHByZXZDdW11bGF0aXZlU2l6ZSA9IG1pZCA+IDAgPyBjdW11bGF0aXZlW21pZCAtIDFdIDogMDtcblxuICAgICAgaWYgKHBvc2l0aW9uID49IHByZXZDdW11bGF0aXZlU2l6ZSAmJiBwb3NpdGlvbiA8IGN1bXVsYXRpdmVTaXplKSB7XG4gICAgICAgIHJldHVybiBtaWQ7XG4gICAgICB9IGVsc2UgaWYgKHBvc2l0aW9uIDwgcHJldkN1bXVsYXRpdmVTaXplKSB7XG4gICAgICAgIHJpZ2h0ID0gbWlkIC0gMTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxlZnQgPSBtaWQgKyAxO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBNYXRoLm1heCgwLCBNYXRoLm1pbihsZWZ0LCBjdW11bGF0aXZlLmxlbmd0aCAtIDEpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHByaXZhdGUgX2dldFBvc2l0aW9uRm9ySW5kZXgoaW5kZXg6IG51bWJlciwgaXNIb3Jpem9udGFsOiBib29sZWFuKTogbnVtYmVyIHtcbiAgICBjb25zdCBjdW11bGF0aXZlID0gaXNIb3Jpem9udGFsID8gdGhpcy5fY3VtdWxhdGl2ZVdpZHRocyA6IHRoaXMuX2N1bXVsYXRpdmVIZWlnaHRzO1xuXG4gICAgaWYgKGN1bXVsYXRpdmUubGVuZ3RoID09PSAwIHx8IGluZGV4ID09PSAwKSB7XG4gICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICBpZiAoaW5kZXggPj0gY3VtdWxhdGl2ZS5sZW5ndGgpIHtcbiAgICAgIC8vIEZhbGxiYWNrIGZvciBvdXQtb2YtYm91bmRzXG4gICAgICBjb25zdCBpdGVtU2l6ZSA9IGlzSG9yaXpvbnRhbCA/IHRoaXMuaXRlbVdpZHRoIDogdGhpcy5pdGVtSGVpZ2h0O1xuICAgICAgcmV0dXJuIGluZGV4ICogaXRlbVNpemU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGluZGV4ID4gMCA/IGN1bXVsYXRpdmVbaW5kZXggLSAxXSA6IDA7XG4gIH1cblxuICAvKiogQGludGVybmFsICovXG4gIHByaXZhdGUgX2hhbmRsZUl0ZW1zQ2hhbmdlZChpdGVtczogQ29sbGVjdGlvbiB8IG51bGwgfCB1bmRlZmluZWQsIGNvbGxlY3Rpb25TdHJhdGVneTogSUNvbGxlY3Rpb25TdHJhdGVneSk6IHZvaWQge1xuICAgIGNvbnN0IHJlcGVhdENvbnRyb2xsZXIgPSB0aGlzLiRjb250cm9sbGVyITtcbiAgICBjb25zdCBpdGVtQ291bnQgPSBjb2xsZWN0aW9uU3RyYXRlZ3kuY291bnQ7XG4gICAgY29uc3Qgdmlld3MgPSB0aGlzLnZpZXdzO1xuXG4gICAgbGV0IGkgPSAwO1xuICAgIGxldCBjdXJyVmlld0NvdW50ID0gdmlld3MubGVuZ3RoO1xuICAgIGxldCB2aWV3OiBJU3ludGhldGljVmlldyB8IG51bGwgPSBudWxsO1xuXG4gICAgaWYgKGl0ZW1Db3VudCA9PT0gMCkge1xuICAgICAgLy8gdG9kbzogbm8gYXN5bmMgc3VwcG9ydGVkXG4gICAgICBmb3IgKGkgPSAwOyBjdXJyVmlld0NvdW50ID4gaTsgKytpKSB7XG4gICAgICAgIHZpZXcgPSB2aWV3c1tpXTtcbiAgICAgICAgdm9pZCB2aWV3LmRlYWN0aXZhdGUodmlldywgcmVwZWF0Q29udHJvbGxlcik7XG4gICAgICB9XG4gICAgICB2aWV3cy5zcGxpY2UoMCk7XG4gICAgICB0aGlzLl9yZXNldENhbGN1bGF0aW9uKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXRlbUhlaWdodCA9PT0gMCkge1xuICAgICAgLy8gbm90IHN1cmUgd2hhdCB0byBkbyBoZXJlXG4gICAgICAvLyB0aGlzIGxpa2VseSBtZWFucyB0aGUgdmlydHVhbCByZXBlYXQgaXMgaW4gYSBoaWRkZW4gc2Nyb2xsZXJcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBvbmx5IGVuc3VyZSB0aGVyZSdzIGVub3VnaCB2aWV3c1xuICAgIC8vIGRvbid0IGFjdGl2YXRlIHlldFxuICAgIGNvbnN0IGJ1ZmZlck11bHRpcGxpZXIgPSB0aGlzLl9jb25maWd1cmVkQnVmZmVyU2l6ZSA/PyAyO1xuICAgIGNvbnN0IG1heFZpZXdzUmVxdWlyZWQgPSB0aGlzLm1pblZpZXdzUmVxdWlyZWQgKiBidWZmZXJNdWx0aXBsaWVyO1xuICAgIGNvbnN0IHJlYWxWaWV3Q291bnQgPSBNYXRoLm1pbihtYXhWaWV3c1JlcXVpcmVkLCBpdGVtQ291bnQpO1xuICAgIGlmIChjdXJyVmlld0NvdW50ID4gbWF4Vmlld3NSZXF1aXJlZCkge1xuICAgICAgd2hpbGUgKGN1cnJWaWV3Q291bnQgPiBtYXhWaWV3c1JlcXVpcmVkKSB7XG4gICAgICAgIHZpZXcgPSB2aWV3c1tjdXJyVmlld0NvdW50IC0gMV07XG4gICAgICAgIHZvaWQgdmlldy5kZWFjdGl2YXRlKHZpZXcsIHJlcGVhdENvbnRyb2xsZXIpO1xuICAgICAgICAtLWN1cnJWaWV3Q291bnQ7XG4gICAgICB9XG4gICAgICB2aWV3cy5zcGxpY2UoY3VyclZpZXdDb3VudCk7XG4gICAgfVxuICAgIGlmIChjdXJyVmlld0NvdW50ID4gaXRlbUNvdW50KSB7XG4gICAgICAvLyByZW1vdmUgdmlld3MgZnJvbSBib3R0b20gdG8gdG9wXG4gICAgICB3aGlsZSAoY3VyclZpZXdDb3VudCA+IGl0ZW1Db3VudCkge1xuICAgICAgICB2aWV3ID0gdmlld3NbY3VyclZpZXdDb3VudCAtIDFdO1xuICAgICAgICB2b2lkIHZpZXcuZGVhY3RpdmF0ZSh2aWV3LCByZXBlYXRDb250cm9sbGVyKTtcbiAgICAgICAgLS1jdXJyVmlld0NvdW50O1xuICAgICAgfVxuICAgICAgdmlld3Muc3BsaWNlKGl0ZW1Db3VudCk7XG4gICAgfVxuICAgIGN1cnJWaWV3Q291bnQgPSB2aWV3cy5sZW5ndGg7XG5cbiAgICBmb3IgKGkgPSBjdXJyVmlld0NvdW50OyBpIDwgcmVhbFZpZXdDb3VudDsgaSsrKSB7XG4gICAgICB2aWV3cy5wdXNoKHRoaXMuX2ZhY3RvcnkuY3JlYXRlKCkpO1xuICAgIH1cbiAgICBjb25zdCBpc0hvcml6b250YWwgPSB0aGlzLl9jb25maWd1cmVkTGF5b3V0ID09PSAnaG9yaXpvbnRhbCc7XG4gICAgY29uc3QgaXRlbUhlaWdodCA9IHRoaXMuaXRlbUhlaWdodDtcbiAgICBjb25zdCBpdGVtU2l6ZSA9IGlzSG9yaXpvbnRhbCA/IHRoaXMuaXRlbVdpZHRoIDogaXRlbUhlaWdodDtcbiAgICBjb25zdCBsb2NhbCA9IHRoaXMubG9jYWw7XG4gICAgY29uc3Qge1xuICAgICAgZmlyc3RJbmRleCxcbiAgICAgIHRvcENvdW50LFxuICAgICAgYm90Q291bnQsXG4gICAgfSA9IHRoaXMubWVhc3VyZUJ1ZmZlcih0aGlzLmRvbS5zY3JvbGxlciwgdmlld3MubGVuZ3RoLCBpdGVtQ291bnQsIGl0ZW1IZWlnaHQpO1xuXG4gICAgbGV0IGlkeCA9IDA7XG4gICAgbGV0IGl0ZW06IHVua25vd247XG4gICAgbGV0IHByZXZWaWV3OiBJU3ludGhldGljVmlldztcbiAgICBsZXQgc2NvcGU6IElSZXBlYXRlckl0ZW1TY29wZTtcblxuICAgIGZvciAoaSA9IDA7IHJlYWxWaWV3Q291bnQgPiBpOyArK2kpIHtcbiAgICAgIGlkeCA9IGZpcnN0SW5kZXggKyBpO1xuICAgICAgaXRlbSA9IGNvbGxlY3Rpb25TdHJhdGVneS5pdGVtKGlkeCk7XG4gICAgICB2aWV3ID0gdmlld3NbaV07XG4gICAgICBwcmV2VmlldyA9IHZpZXdzW2kgLSAxXTtcbiAgICAgIGlmICh2aWV3LmlzQWN0aXZlKSB7XG4gICAgICAgIHNjb3BlID0gdmlldy5zY29wZSBhcyBJUmVwZWF0ZXJJdGVtU2NvcGU7XG4gICAgICAgIHNjb3BlLmJpbmRpbmdDb250ZXh0W2xvY2FsXSA9IGl0ZW07XG4gICAgICAgIHNjb3BlLm92ZXJyaWRlQ29udGV4dC4kaW5kZXggPSBpZHg7XG4gICAgICAgIHNjb3BlLm92ZXJyaWRlQ29udGV4dC4kbGVuZ3RoID0gaXRlbUNvdW50O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmlldy5ub2Rlcy5pbnNlcnRCZWZvcmUocHJldlZpZXcubm9kZXMuZmlyc3RDaGlsZCEubmV4dFNpYmxpbmchKTtcbiAgICAgICAgc2NvcGUgPSBTY29wZS5mcm9tUGFyZW50KFxuICAgICAgICAgIHJlcGVhdENvbnRyb2xsZXIuc2NvcGUsXG4gICAgICAgICAgbmV3IEJpbmRpbmdDb250ZXh0KGxvY2FsLCBjb2xsZWN0aW9uU3RyYXRlZ3kuaXRlbShpZHgpKVxuICAgICAgICApIGFzIElSZXBlYXRlckl0ZW1TY29wZTtcbiAgICAgICAgc2NvcGUub3ZlcnJpZGVDb250ZXh0LiRpbmRleCA9IGlkeDtcbiAgICAgICAgc2NvcGUub3ZlcnJpZGVDb250ZXh0LiRsZW5ndGggPSBpdGVtQ291bnQ7XG4gICAgICAgIGVuaGFuY2VPdmVycmlkZUNvbnRleHQoc2NvcGUub3ZlcnJpZGVDb250ZXh0KTtcbiAgICAgICAgdm9pZCB2aWV3LmFjdGl2YXRlKHJlcGVhdENvbnRyb2xsZXIsIHJlcGVhdENvbnRyb2xsZXIsIHNjb3BlKTtcbiAgICAgIH1cblxuICAgICAgLy8gTWVhc3VyZSBpdGVtIHNpemUgZm9yIHZhcmlhYmxlIHNpemluZ1xuICAgICAgaWYgKChpc0hvcml6b250YWwgJiYgdGhpcy5fY29uZmlndXJlZFZhcmlhYmxlV2lkdGgpIHx8ICghaXNIb3Jpem9udGFsICYmIHRoaXMuX2NvbmZpZ3VyZWRWYXJpYWJsZUhlaWdodCkpIHtcbiAgICAgICAgdGhpcy5fbWVhc3VyZUFuZFN0b3JlSXRlbVNpemUodmlldywgaWR4KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBCdWlsZCBjdW11bGF0aXZlIHNpemVzIGZvciB2YXJpYWJsZSBzaXppbmcgYWZ0ZXIgbWVhc3VyaW5nIGl0ZW1zXG4gICAgaWYgKChpc0hvcml6b250YWwgJiYgdGhpcy5fY29uZmlndXJlZFZhcmlhYmxlV2lkdGgpIHx8ICghaXNIb3Jpem9udGFsICYmIHRoaXMuX2NvbmZpZ3VyZWRWYXJpYWJsZUhlaWdodCkpIHtcbiAgICAgIHRoaXMuX2J1aWxkQ3VtdWxhdGl2ZVNpemVzKGl0ZW1Db3VudCk7XG4gICAgfVxuXG4gICAgLy8gQ2FsY3VsYXRlIGJ1ZmZlciBzaXplc1xuICAgIGxldCB0b3BCdWZmZXJTaXplID0gMDtcbiAgICBsZXQgYm90QnVmZmVyU2l6ZSA9IDA7XG5cbiAgICBpZiAoKGlzSG9yaXpvbnRhbCAmJiB0aGlzLl9jb25maWd1cmVkVmFyaWFibGVXaWR0aCkgfHwgKCFpc0hvcml6b250YWwgJiYgdGhpcy5fY29uZmlndXJlZFZhcmlhYmxlSGVpZ2h0KSkge1xuICAgICAgLy8gVmFyaWFibGUgc2l6aW5nOiBjYWxjdWxhdGUgYWN0dWFsIGN1bXVsYXRpdmUgc2l6ZXNcbiAgICAgIHRvcEJ1ZmZlclNpemUgPSB0aGlzLl9nZXRQb3NpdGlvbkZvckluZGV4KHRvcENvdW50LCBpc0hvcml6b250YWwpO1xuICAgICAgYm90QnVmZmVyU2l6ZSA9IHRoaXMuX2dldFBvc2l0aW9uRm9ySW5kZXgoaXRlbUNvdW50IC0gZmlyc3RJbmRleCAtIHJlYWxWaWV3Q291bnQsIGlzSG9yaXpvbnRhbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZpeGVkIHNpemluZzogdXNlIG11bHRpcGxpY2F0aW9uXG4gICAgICB0b3BCdWZmZXJTaXplID0gdG9wQ291bnQgKiBpdGVtU2l6ZTtcbiAgICAgIGJvdEJ1ZmZlclNpemUgPSBib3RDb3VudCAqIGl0ZW1TaXplO1xuICAgIH1cblxuICAgIHRoaXMuZG9tLnVwZGF0ZSh0b3BCdWZmZXJTaXplLCBib3RCdWZmZXJTaXplKTtcbiAgfVxuXG4gIC8qKiBAaW50ZXJuYWwgKi9cbiAgcHVibGljIGl0ZW1zQ2hhbmdlZChpdGVtcz86IENvbGxlY3Rpb24gfCBudWxsKTogdm9pZCB7XG4gICAgdGhpcy5fb2JzTWVkaWF0b3Iuc3RhcnQoaXRlbXMpO1xuICAgIHRoaXMuY29sbGVjdGlvblN0cmF0ZWd5ID0gdGhpcy5fc3RyYXRlZ3lMb2NhdG9yLmdldFN0cmF0ZWd5KGl0ZW1zKTtcbiAgICB0aGlzLl9xdWV1ZUhhbmRsZUl0ZW1zQ2hhbmdlZCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSB2YWx1ZSByZXR1cm5lZCBieSBIVE1MRWxlbWVudC5wcm90b3R5cGUuc2Nyb2xsVG9wIGlzbid0IGFsd2F5cyByZWxpYWJsZS5cbiAgICogV2hlbiB0aGUgdmlydHVhbCByZXBlYXRlciBpcyBwbGFjZWQgYWZ0ZXIgYSBsb25nIGxpc3Qgb2YgZWxlbWVudHMsIGl0cyBcInJlYWxcIiBzY3JvbGx0b3BcbiAgICogd2lsbCBiZSBkaWZmZXJlbnQgd2l0aCB0aGlzIHZhbHVlLiBBbiBleGFtcGxlIGlzIHZpcnR1YWwgcmVwZWF0IG9uIHRhYmxlLFxuICAgKiB0aGUgaGVhZGVyIHNob3VsZG4ndCBiZSBvZiB0aGUgc2Nyb2xsIHRvcCBjYWxjdWxhdGlvblxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHByaXZhdGUgX2NhbGNSZWFsU2Nyb2xsVG9wKHNjcm9sbGVyOiBIVE1MRWxlbWVudCkge1xuICAgIGNvbnN0IHNjcm9sbGVyX3Njcm9sbF90b3AgPSBzY3JvbGxlci5zY3JvbGxUb3A7XG4gICAgY29uc3QgdG9wX2J1ZmZlcl9kaXN0YW5jZSA9IGdldERpc3RhbmNlVG9TY3JvbGxlcih0aGlzLmRvbS50b3AsIHNjcm9sbGVyKTtcbiAgICBjb25zdCByZWFsX3Njcm9sbF90b3AgPSBNYXRoLm1heCgwLCBzY3JvbGxlcl9zY3JvbGxfdG9wID09PSAwXG4gICAgICA/IDBcbiAgICAgIDogKHNjcm9sbGVyX3Njcm9sbF90b3AgLSB0b3BfYnVmZmVyX2Rpc3RhbmNlKSk7XG4gICAgcmV0dXJuIHJlYWxfc2Nyb2xsX3RvcDtcbiAgfVxuXG4gIC8qKlxuICAgKiBTaW1pbGFyIHRvIF9jYWxjUmVhbFNjcm9sbFRvcCBidXQgZm9yIGhvcml6b250YWwgc2Nyb2xsaW5nXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcHJpdmF0ZSBfY2FsY1JlYWxTY3JvbGxMZWZ0KHNjcm9sbGVyOiBIVE1MRWxlbWVudCkge1xuICAgIGNvbnN0IHNjcm9sbGVyX3Njcm9sbF9sZWZ0ID0gc2Nyb2xsZXIuc2Nyb2xsTGVmdDtcbiAgICBjb25zdCBsZWZ0X2J1ZmZlcl9kaXN0YW5jZSA9IGdldEhvcml6b250YWxEaXN0YW5jZVRvU2Nyb2xsZXIodGhpcy5kb20udG9wLCBzY3JvbGxlcik7XG4gICAgY29uc3QgcmVhbF9zY3JvbGxfbGVmdCA9IE1hdGgubWF4KDAsIHNjcm9sbGVyX3Njcm9sbF9sZWZ0ID09PSAwXG4gICAgICA/IDBcbiAgICAgIDogKHNjcm9sbGVyX3Njcm9sbF9sZWZ0IC0gbGVmdF9idWZmZXJfZGlzdGFuY2UpKTtcbiAgICByZXR1cm4gcmVhbF9zY3JvbGxfbGVmdDtcbiAgfVxuXG4gIC8qKiBAaW50ZXJuYWwgKi9cbiAgcHJpdmF0ZSBtZWFzdXJlQnVmZmVyKHNjcm9sbGVyOiBIVE1MRWxlbWVudCwgdmlld0NvdW50OiBudW1iZXIsIGNvbGxlY3Rpb25TaXplOiBudW1iZXIsIGl0ZW1IZWlnaHQ6IG51bWJlcik6IElCdWZmZXJDYWxjdWxhdGlvbiB7XG4gICAgY29uc3QgaXNIb3Jpem9udGFsID0gdGhpcy5fY29uZmlndXJlZExheW91dCA9PT0gJ2hvcml6b250YWwnO1xuICAgIGNvbnN0IGlzVmFyaWFibGVTaXppbmcgPSBpc0hvcml6b250YWwgPyB0aGlzLl9jb25maWd1cmVkVmFyaWFibGVXaWR0aCA6IHRoaXMuX2NvbmZpZ3VyZWRWYXJpYWJsZUhlaWdodDtcblxuICAgIGlmIChpc1ZhcmlhYmxlU2l6aW5nICYmIChpc0hvcml6b250YWwgPyB0aGlzLl9jdW11bGF0aXZlV2lkdGhzLmxlbmd0aCA+IDAgOiB0aGlzLl9jdW11bGF0aXZlSGVpZ2h0cy5sZW5ndGggPiAwKSkge1xuICAgICAgcmV0dXJuIHRoaXMuX21lYXN1cmVCdWZmZXJWYXJpYWJsZShzY3JvbGxlciwgdmlld0NvdW50LCBjb2xsZWN0aW9uU2l6ZSwgaXNIb3Jpem9udGFsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRoaXMuX21lYXN1cmVCdWZmZXJGaXhlZChzY3JvbGxlciwgdmlld0NvdW50LCBjb2xsZWN0aW9uU2l6ZSwgaXRlbUhlaWdodCwgaXNIb3Jpem9udGFsKTtcbiAgICB9XG4gIH1cblxuICAvKiogQGludGVybmFsICovXG4gIHByaXZhdGUgX21lYXN1cmVCdWZmZXJGaXhlZChzY3JvbGxlcjogSFRNTEVsZW1lbnQsIHZpZXdDb3VudDogbnVtYmVyLCBjb2xsZWN0aW9uU2l6ZTogbnVtYmVyLCBpdGVtSGVpZ2h0OiBudW1iZXIsIGlzSG9yaXpvbnRhbDogYm9vbGVhbik6IElCdWZmZXJDYWxjdWxhdGlvbiB7XG4gICAgY29uc3QgaXRlbVNpemUgPSBpc0hvcml6b250YWwgPyB0aGlzLml0ZW1XaWR0aCA6IGl0ZW1IZWlnaHQ7XG4gICAgY29uc3QgcmVhbFNjcm9sbCA9IGlzSG9yaXpvbnRhbFxuICAgICAgPyB0aGlzLl9jYWxjUmVhbFNjcm9sbExlZnQoc2Nyb2xsZXIpXG4gICAgICA6IHRoaXMuX2NhbGNSZWFsU2Nyb2xsVG9wKHNjcm9sbGVyKTtcblxuICAgIGxldCBmaXJzdF9pbmRleF9hZnRlcl9zY3JvbGxfYWRqdXN0bWVudCA9IHJlYWxTY3JvbGwgPT09IDBcbiAgICAgID8gMFxuICAgICAgOiBNYXRoLmZsb29yKHJlYWxTY3JvbGwgLyBpdGVtU2l6ZSk7XG5cbiAgICAvLyBpZiBmaXJzdCBpbmRleCBhZnRlciBzY3JvbGwgYWRqdXN0bWVudCBkb2Vzbid0IGZpdCB3aXRoIG51bWJlciBvZiBwb3NzaWJsZSB2aWV3XG4gICAgLy8gaXQgbWVhbnMgdGhlIHNjcm9sbGVyIGhhcyBiZWVuIHRvbyBmYXIgZG93biB0byB0aGUgYm90dG9tIGFuZCBub2xvbmdlciBzdWl0YWJsZSB0byBzdGFydCBmcm9tIHRoaXMgaW5kZXhcbiAgICAvLyByb2xsYmFjayB1bnRpbCBhbGwgdmlld3MgZml0IGludG8gbmV3IGNvbGxlY3Rpb24sIG9yIHVudGlsIGhhcyBlbm91Z2ggY29sbGVjdGlvbiBpdGVtIHRvIHJlbmRlclxuICAgIGlmIChmaXJzdF9pbmRleF9hZnRlcl9zY3JvbGxfYWRqdXN0bWVudCArIHZpZXdDb3VudCA+PSBjb2xsZWN0aW9uU2l6ZSkge1xuICAgICAgZmlyc3RfaW5kZXhfYWZ0ZXJfc2Nyb2xsX2FkanVzdG1lbnQgPSBNYXRoLm1heCgwLCBjb2xsZWN0aW9uU2l6ZSAtIHZpZXdDb3VudCk7XG4gICAgfVxuICAgIGNvbnN0IHRvcF9idWZmZXJfaXRlbV9jb3VudF9hZnRlcl9zY3JvbGxfYWRqdXN0bWVudCA9IGZpcnN0X2luZGV4X2FmdGVyX3Njcm9sbF9hZGp1c3RtZW50O1xuICAgIGNvbnN0IGJvdF9idWZmZXJfaXRlbV9jb3VudF9hZnRlcl9zY3JvbGxfYWRqdXN0bWVudCA9IE1hdGgubWF4KFxuICAgICAgMCxcbiAgICAgIGNvbGxlY3Rpb25TaXplIC0gdG9wX2J1ZmZlcl9pdGVtX2NvdW50X2FmdGVyX3Njcm9sbF9hZGp1c3RtZW50IC0gdmlld0NvdW50XG4gICAgKTtcblxuICAgIHJldHVybiB7XG4gICAgICBmaXJzdEluZGV4OiBmaXJzdF9pbmRleF9hZnRlcl9zY3JvbGxfYWRqdXN0bWVudCxcbiAgICAgIHRvcENvdW50OiB0b3BfYnVmZmVyX2l0ZW1fY291bnRfYWZ0ZXJfc2Nyb2xsX2FkanVzdG1lbnQsXG4gICAgICBib3RDb3VudDogYm90X2J1ZmZlcl9pdGVtX2NvdW50X2FmdGVyX3Njcm9sbF9hZGp1c3RtZW50LFxuICAgIH07XG4gIH1cblxuICAvKiogQGludGVybmFsICovXG4gIHByaXZhdGUgX21lYXN1cmVCdWZmZXJWYXJpYWJsZShzY3JvbGxlcjogSFRNTEVsZW1lbnQsIHZpZXdDb3VudDogbnVtYmVyLCBjb2xsZWN0aW9uU2l6ZTogbnVtYmVyLCBpc0hvcml6b250YWw6IGJvb2xlYW4pOiBJQnVmZmVyQ2FsY3VsYXRpb24ge1xuICAgIGNvbnN0IHJlYWxTY3JvbGwgPSBpc0hvcml6b250YWxcbiAgICAgID8gdGhpcy5fY2FsY1JlYWxTY3JvbGxMZWZ0KHNjcm9sbGVyKVxuICAgICAgOiB0aGlzLl9jYWxjUmVhbFNjcm9sbFRvcChzY3JvbGxlcik7XG5cbiAgICBsZXQgZmlyc3RfaW5kZXhfYWZ0ZXJfc2Nyb2xsX2FkanVzdG1lbnQgPSByZWFsU2Nyb2xsID09PSAwXG4gICAgICA/IDBcbiAgICAgIDogdGhpcy5fZmluZEluZGV4QnlQb3NpdGlvbihyZWFsU2Nyb2xsLCBpc0hvcml6b250YWwpO1xuXG4gICAgLy8gaWYgZmlyc3QgaW5kZXggYWZ0ZXIgc2Nyb2xsIGFkanVzdG1lbnQgZG9lc24ndCBmaXQgd2l0aCBudW1iZXIgb2YgcG9zc2libGUgdmlld1xuICAgIC8vIGl0IG1lYW5zIHRoZSBzY3JvbGxlciBoYXMgYmVlbiB0b28gZmFyIGRvd24gdG8gdGhlIGJvdHRvbSBhbmQgbm9sb25nZXIgc3VpdGFibGUgdG8gc3RhcnQgZnJvbSB0aGlzIGluZGV4XG4gICAgLy8gcm9sbGJhY2sgdW50aWwgYWxsIHZpZXdzIGZpdCBpbnRvIG5ldyBjb2xsZWN0aW9uLCBvciB1bnRpbCBoYXMgZW5vdWdoIGNvbGxlY3Rpb24gaXRlbSB0byByZW5kZXJcbiAgICBpZiAoZmlyc3RfaW5kZXhfYWZ0ZXJfc2Nyb2xsX2FkanVzdG1lbnQgKyB2aWV3Q291bnQgPj0gY29sbGVjdGlvblNpemUpIHtcbiAgICAgIGZpcnN0X2luZGV4X2FmdGVyX3Njcm9sbF9hZGp1c3RtZW50ID0gTWF0aC5tYXgoMCwgY29sbGVjdGlvblNpemUgLSB2aWV3Q291bnQpO1xuICAgIH1cbiAgICBjb25zdCB0b3BfYnVmZmVyX2l0ZW1fY291bnRfYWZ0ZXJfc2Nyb2xsX2FkanVzdG1lbnQgPSBmaXJzdF9pbmRleF9hZnRlcl9zY3JvbGxfYWRqdXN0bWVudDtcbiAgICBjb25zdCBib3RfYnVmZmVyX2l0ZW1fY291bnRfYWZ0ZXJfc2Nyb2xsX2FkanVzdG1lbnQgPSBNYXRoLm1heChcbiAgICAgIDAsXG4gICAgICBjb2xsZWN0aW9uU2l6ZSAtIHRvcF9idWZmZXJfaXRlbV9jb3VudF9hZnRlcl9zY3JvbGxfYWRqdXN0bWVudCAtIHZpZXdDb3VudFxuICAgICk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgZmlyc3RJbmRleDogZmlyc3RfaW5kZXhfYWZ0ZXJfc2Nyb2xsX2FkanVzdG1lbnQsXG4gICAgICB0b3BDb3VudDogdG9wX2J1ZmZlcl9pdGVtX2NvdW50X2FmdGVyX3Njcm9sbF9hZGp1c3RtZW50LFxuICAgICAgYm90Q291bnQ6IGJvdF9idWZmZXJfaXRlbV9jb3VudF9hZnRlcl9zY3JvbGxfYWRqdXN0bWVudCxcbiAgICB9O1xuICB9XG5cbiAgLyoqIEBpbnRlcm5hbCAqL1xuICBwcml2YXRlIF9wcmV2U2Nyb2xsOiBudW1iZXIgPSAwO1xuICAvKiogQGludGVybmFsICovXG4gIHByaXZhdGUgaGFuZGxlU2Nyb2xsKHNjcm9sbGVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IHZpZXdzID0gdGhpcy52aWV3cztcbiAgICBjb25zdCB2aWV3Q291bnQgPSB2aWV3cy5sZW5ndGg7XG4gICAgaWYgKHZpZXdDb3VudCA9PT0gMCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxvY2FsID0gdGhpcy5sb2NhbDtcbiAgICBjb25zdCBpc0hvcml6b250YWwgPSB0aGlzLl9jb25maWd1cmVkTGF5b3V0ID09PSAnaG9yaXpvbnRhbCc7XG4gICAgY29uc3QgaXRlbUhlaWdodCA9IHRoaXMuaXRlbUhlaWdodDtcbiAgICBjb25zdCBpdGVtU2l6ZSA9IGlzSG9yaXpvbnRhbCA/IHRoaXMuaXRlbVdpZHRoIDogaXRlbUhlaWdodDtcbiAgICBjb25zdCByZXBlYXREb20gPSB0aGlzLmRvbTtcbiAgICBjb25zdCBjb2xsZWN0aW9uU3RyYXRlZ3kgPSB0aGlzLmNvbGxlY3Rpb25TdHJhdGVneSE7XG4gICAgY29uc3QgY29sbGVjdGlvblNpemUgPSBjb2xsZWN0aW9uU3RyYXRlZ3kuY291bnQ7XG4gICAgY29uc3QgcHJldkZpcnN0SW5kZXggPSAodmlld3NbMF0uc2NvcGUgYXMgSVJlcGVhdGVySXRlbVNjb3BlKS5vdmVycmlkZUNvbnRleHQuJGluZGV4O1xuICAgIGNvbnN0IHtcbiAgICAgIGZpcnN0SW5kZXg6IGN1cnJGaXJzdEluZGV4LFxuICAgICAgdG9wQ291bnQ6IHRvcENvdW50MSxcbiAgICAgIGJvdENvdW50OiBib3RDb3VudDFcbiAgICB9ID0gdGhpcy5tZWFzdXJlQnVmZmVyKHNjcm9sbGVyLCB2aWV3Q291bnQsIGNvbGxlY3Rpb25TaXplLCBpdGVtSGVpZ2h0KTtcbiAgICBjb25zdCBpc1Njcm9sbGluZ1Rvd2FyZHNFbmQgPSBpc0hvcml6b250YWxcbiAgICAgID8gc2Nyb2xsZXIuc2Nyb2xsTGVmdCA+IHRoaXMuX3ByZXZTY3JvbGxcbiAgICAgIDogc2Nyb2xsZXIuc2Nyb2xsVG9wID4gdGhpcy5fcHJldlNjcm9sbDtcbiAgICBjb25zdCBpc0p1bXBpbmcgPSBpc1Njcm9sbGluZ1Rvd2FyZHNFbmRcbiAgICAgID8gY3VyckZpcnN0SW5kZXggPj0gcHJldkZpcnN0SW5kZXggKyB2aWV3Q291bnRcbiAgICAgIDogY3VyckZpcnN0SW5kZXggKyB2aWV3Q291bnQgPD0gcHJldkZpcnN0SW5kZXg7XG4gICAgdGhpcy5fcHJldlNjcm9sbCA9IGlzSG9yaXpvbnRhbCA/IHNjcm9sbGVyLnNjcm9sbExlZnQgOiBzY3JvbGxlci5zY3JvbGxUb3A7XG5cbiAgICBpZiAoY3VyckZpcnN0SW5kZXggPT09IHByZXZGaXJzdEluZGV4KSB7XG4gICAgICAvLyBub3QgbW92aW5nIGVub3VnaCB0byBjaGFuZ2UgdGhlIHZpZXcgcmFuZ2VcbiAgICAgIC8vIHNvIGp1c3QgY2hlY2sgZ2V0IG1vcmUgb3Igbm90XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc3RhbnQtY29uZGl0aW9uXG4gICAgICBpZiAoLyogaXMgc2Nyb2xsaW5nIHVwICYgbmVhciB0b3AgKi90cnVlKSB7XG4gICAgICAgIC8vIGVtcHR5XG4gICAgICB9XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc3RhbnQtY29uZGl0aW9uXG4gICAgICBpZiAoLyogaXMgc2Nyb2xsaW5nIGRvd24gJiBuZWFyIGJvdHRvbSAqL3RydWUpIHtcbiAgICAgICAgLy8gZW1wdHlcbiAgICAgIH1cbiAgICAgIC8vIGV4aXQgaGVyZVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGxldCB2aWV3OiBJU3ludGhldGljVmlldyB8IG51bGwgPSBudWxsO1xuICAgIGxldCBzY29wZTogSVJlcGVhdGVySXRlbVNjb3BlIHwgbnVsbCA9IG51bGw7XG4gICAgbGV0IGlkeCA9IDA7XG4gICAgbGV0IHZpZXdzVG9Nb3ZlQ291bnQgPSAwO1xuICAgIGxldCBpZHhJbmNyZW1lbnQgPSAwO1xuICAgIGxldCBpID0gMDtcblxuICAgIGlmIChpc0p1bXBpbmcpIHtcbiAgICAgIGZvciAoaSA9IDA7IHZpZXdDb3VudCA+IGk7ICsraSkge1xuICAgICAgICBpZHggPSBjdXJyRmlyc3RJbmRleCArIGk7XG4gICAgICAgIHNjb3BlID0gdmlld3NbaV0uc2NvcGUgYXMgSVJlcGVhdGVySXRlbVNjb3BlO1xuICAgICAgICBzY29wZS5iaW5kaW5nQ29udGV4dFtsb2NhbF0gPSBjb2xsZWN0aW9uU3RyYXRlZ3kuaXRlbShpZHgpO1xuICAgICAgICBzY29wZS5vdmVycmlkZUNvbnRleHQuJGluZGV4ID0gaWR4O1xuICAgICAgICBzY29wZS5vdmVycmlkZUNvbnRleHQuJGxlbmd0aCA9IGNvbGxlY3Rpb25TaXplO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoaXNTY3JvbGxpbmdUb3dhcmRzRW5kKSB7XG4gICAgICB2aWV3c1RvTW92ZUNvdW50ID0gY3VyckZpcnN0SW5kZXggLSBwcmV2Rmlyc3RJbmRleDtcbiAgICAgIHdoaWxlICh2aWV3c1RvTW92ZUNvdW50ID4gMCkge1xuICAgICAgICB2aWV3ID0gdmlld3Muc2hpZnQoKSE7XG4gICAgICAgIGlkeCA9IHZpZXdzW3ZpZXdzLmxlbmd0aCAtIDFdLnNjb3BlLm92ZXJyaWRlQ29udGV4dFsnJGluZGV4J10gYXMgbnVtYmVyICsgMTtcbiAgICAgICAgdmlld3MucHVzaCh2aWV3KTtcbiAgICAgICAgc2NvcGUgPSB2aWV3LnNjb3BlIGFzIElSZXBlYXRlckl0ZW1TY29wZTtcbiAgICAgICAgc2NvcGUuYmluZGluZ0NvbnRleHRbbG9jYWxdID0gY29sbGVjdGlvblN0cmF0ZWd5Lml0ZW0oaWR4KTtcbiAgICAgICAgc2NvcGUub3ZlcnJpZGVDb250ZXh0LiRpbmRleCA9IGlkeDtcbiAgICAgICAgc2NvcGUub3ZlcnJpZGVDb250ZXh0LiRsZW5ndGggPSBjb2xsZWN0aW9uU2l6ZTtcbiAgICAgICAgdmlldy5ub2Rlcy5pbnNlcnRCZWZvcmUocmVwZWF0RG9tLmJvdHRvbSk7XG4gICAgICAgICsraWR4SW5jcmVtZW50O1xuICAgICAgICAtLXZpZXdzVG9Nb3ZlQ291bnQ7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHZpZXdzVG9Nb3ZlQ291bnQgPSBwcmV2Rmlyc3RJbmRleCAtIGN1cnJGaXJzdEluZGV4O1xuICAgICAgd2hpbGUgKHZpZXdzVG9Nb3ZlQ291bnQgPiAwKSB7XG4gICAgICAgIGlkeCA9IHByZXZGaXJzdEluZGV4IC0gKGlkeEluY3JlbWVudCArIDEpO1xuICAgICAgICB2aWV3ID0gdmlld3MucG9wKCkhO1xuICAgICAgICBzY29wZSA9IHZpZXcuc2NvcGUgYXMgSVJlcGVhdGVySXRlbVNjb3BlO1xuICAgICAgICBzY29wZS5iaW5kaW5nQ29udGV4dFtsb2NhbF0gPSBjb2xsZWN0aW9uU3RyYXRlZ3kuaXRlbShpZHgpO1xuICAgICAgICBzY29wZS5vdmVycmlkZUNvbnRleHQuJGluZGV4ID0gaWR4O1xuICAgICAgICBzY29wZS5vdmVycmlkZUNvbnRleHQuJGxlbmd0aCA9IGNvbGxlY3Rpb25TaXplO1xuICAgICAgICB2aWV3Lm5vZGVzLmluc2VydEJlZm9yZSh2aWV3c1swXS5ub2Rlcy5maXJzdENoaWxkISk7XG4gICAgICAgIHZpZXdzLnVuc2hpZnQodmlldyk7XG4gICAgICAgICsraWR4SW5jcmVtZW50O1xuICAgICAgICAtLXZpZXdzVG9Nb3ZlQ291bnQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGlzU2Nyb2xsaW5nVG93YXJkc0VuZCkge1xuICAgICAgaWYgKGNvbGxlY3Rpb25TdHJhdGVneS5pc05lYXJCb3R0b20oY3VyckZpcnN0SW5kZXggKyAodmlld0NvdW50IC0gMSkpKSB7XG4gICAgICAgIHJlcGVhdERvbS5zY3JvbGxlci5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChWSVJUVUFMX1JFUEVBVF9ORUFSX0JPVFRPTSwge1xuICAgICAgICAgIGJ1YmJsZXM6IHRydWUsXG4gICAgICAgICAgZGV0YWlsOiB7XG4gICAgICAgICAgICBsYXN0VmlzaWJsZUluZGV4OiBjdXJyRmlyc3RJbmRleCArICh2aWV3Q291bnQgLSAxKSxcbiAgICAgICAgICAgIGl0ZW1Db3VudDogY29sbGVjdGlvblNpemVcbiAgICAgICAgICB9XG4gICAgICAgIH0pKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGNvbGxlY3Rpb25TdHJhdGVneS5pc05lYXJUb3Aodmlld3NbMF0uc2NvcGUub3ZlcnJpZGVDb250ZXh0WyckaW5kZXgnXSBhcyBudW1iZXIpKSB7XG4gICAgICAgIHJlcGVhdERvbS5zY3JvbGxlci5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudChWSVJUVUFMX1JFUEVBVF9ORUFSX1RPUCwge1xuICAgICAgICAgIGJ1YmJsZXM6IHRydWUsXG4gICAgICAgICAgZGV0YWlsOiB7XG4gICAgICAgICAgICBmaXJzdFZpc2libGVJbmRleDogdmlld3NbMF0uc2NvcGUub3ZlcnJpZGVDb250ZXh0WyckaW5kZXgnXSBhcyBudW1iZXIsXG4gICAgICAgICAgICBpdGVtQ291bnQ6IGNvbGxlY3Rpb25TaXplXG4gICAgICAgICAgfVxuICAgICAgICB9KSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ2FsY3VsYXRlIGJ1ZmZlciBzaXplcyBmb3IgRE9NIHVwZGF0ZVxuICAgIGxldCB0b3BCdWZmZXJTaXplID0gMDtcbiAgICBsZXQgYm90QnVmZmVyU2l6ZSA9IDA7XG5cbiAgICBpZiAoKGlzSG9yaXpvbnRhbCAmJiB0aGlzLl9jb25maWd1cmVkVmFyaWFibGVXaWR0aCkgfHwgKCFpc0hvcml6b250YWwgJiYgdGhpcy5fY29uZmlndXJlZFZhcmlhYmxlSGVpZ2h0KSkge1xuICAgICAgLy8gVmFyaWFibGUgc2l6aW5nOiBjYWxjdWxhdGUgYWN0dWFsIGN1bXVsYXRpdmUgc2l6ZXNcbiAgICAgIHRvcEJ1ZmZlclNpemUgPSB0aGlzLl9nZXRQb3NpdGlvbkZvckluZGV4KHRvcENvdW50MSwgaXNIb3Jpem9udGFsKTtcbiAgICAgIGJvdEJ1ZmZlclNpemUgPSB0aGlzLl9nZXRQb3NpdGlvbkZvckluZGV4KGJvdENvdW50MSwgaXNIb3Jpem9udGFsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRml4ZWQgc2l6aW5nOiB1c2UgbXVsdGlwbGljYXRpb25cbiAgICAgIHRvcEJ1ZmZlclNpemUgPSB0b3BDb3VudDEgKiBpdGVtU2l6ZTtcbiAgICAgIGJvdEJ1ZmZlclNpemUgPSBib3RDb3VudDEgKiBpdGVtU2l6ZTtcbiAgICB9XG5cbiAgICByZXBlYXREb20udXBkYXRlKHRvcEJ1ZmZlclNpemUsIGJvdEJ1ZmZlclNpemUpO1xuICB9XG5cbiAgcHVibGljIGdldERpc3RhbmNlcygpOiBbdG9wOiBudW1iZXIsIGJvdHRvbTogbnVtYmVyXSB7XG4gICAgcmV0dXJuIHRoaXMuZG9tPy5kaXN0YW5jZXMgPz8gWzAsIDBdO1xuICB9XG5cbiAgcHVibGljIGdldFZpZXdzKCk6IHJlYWRvbmx5IElTeW50aGV0aWNWaWV3W10ge1xuICAgIHJldHVybiB0aGlzLnZpZXdzLnNsaWNlKDApO1xuICB9XG5cbiAgLyoqXG4gICAqIHRvZG86IGhhbmRsZSB1cGRhdGUgYmFzZWQgb24gY29sbGVjdGlvbiwgcmF0aGVyIHRoYW4gYWx3YXlzIHVwZGF0ZVxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyBfaGFuZGxlQ29sbGVjdGlvbkNoYW5nZSgpOiB2b2lkIHtcbiAgICB0aGlzLl9xdWV1ZUhhbmRsZUl0ZW1zQ2hhbmdlZCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcHVibGljIF9oYW5kbGVJbm5lckNvbGxlY3Rpb25DaGFuZ2UoKTogdm9pZCB7XG4gICAgY29uc3QgbmV3SXRlbXMgPSBhc3RFdmFsdWF0ZSh0aGlzLml0ZXJhYmxlLCB0aGlzLnBhcmVudC5zY29wZSwgeyBzdHJpY3Q6IHRydWUgfSwgbnVsbCkgYXMgQ29sbGVjdGlvbjtcbiAgICBjb25zdCBvbGRJdGVtcyA9IHRoaXMuaXRlbXM7XG4gICAgdGhpcy5pdGVtcyA9IG5ld0l0ZW1zO1xuICAgIGlmIChuZXdJdGVtcyA9PT0gb2xkSXRlbXMpIHtcbiAgICAgIHRoaXMuX3F1ZXVlSGFuZGxlSXRlbXNDaGFuZ2VkKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIEBpbnRlcm5hbCAqL1xuICBwcml2YXRlIF9xdWV1ZUhhbmRsZUl0ZW1zQ2hhbmdlZCgpIHtcbiAgICBjb25zdCB0YXNrID0gdGhpcy50YXNrO1xuICAgIHRoaXMudGFzayA9IHF1ZXVlQXN5bmNUYXNrKCgpID0+IHtcbiAgICAgIHRoaXMudGFzayA9IG51bGw7XG4gICAgICB0aGlzLl9oYW5kbGVJdGVtc0NoYW5nZWQodGhpcy5pdGVtcywgdGhpcy5jb2xsZWN0aW9uU3RyYXRlZ3khKTtcbiAgICB9KTtcbiAgICB0YXNrPy5jYW5jZWwoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHByaXZhdGUgX2NyZWF0ZUFuZEFjdGl2YXRlRmlyc3RWaWV3KCk6IElTeW50aGV0aWNWaWV3IHtcbiAgICBjb25zdCBmaXJzdFZpZXcgPSB0aGlzLmdldE9yQ3JlYXRlRmlyc3RWaWV3KCk7XG4gICAgaWYgKCFmaXJzdFZpZXcuaXNBY3RpdmUpIHtcbiAgICAgIGNvbnN0IHJlcGVhdENvbnRyb2xsZXIgPSB0aGlzLiRjb250cm9sbGVyITtcbiAgICAgIGNvbnN0IGNvbGxlY3Rpb25TdHJhdGVneSA9IHRoaXMuY29sbGVjdGlvblN0cmF0ZWd5ITtcbiAgICAgIGNvbnN0IHBhcmVudFNjb3BlID0gcmVwZWF0Q29udHJvbGxlci5zY29wZTtcbiAgICAgIGNvbnN0IGl0ZW1TY29wZSA9IFNjb3BlLmZyb21QYXJlbnQoXG4gICAgICAgIHBhcmVudFNjb3BlLFxuICAgICAgICBuZXcgQmluZGluZ0NvbnRleHQodGhpcy5sb2NhbCwgY29sbGVjdGlvblN0cmF0ZWd5LmZpcnN0KCkpXG4gICAgICApIGFzIElSZXBlYXRlckl0ZW1TY29wZTtcbiAgICAgIGl0ZW1TY29wZS5vdmVycmlkZUNvbnRleHQuJGluZGV4ID0gMDtcbiAgICAgIGl0ZW1TY29wZS5vdmVycmlkZUNvbnRleHQuJGxlbmd0aCA9IGNvbGxlY3Rpb25TdHJhdGVneS5jb3VudDtcbiAgICAgIGVuaGFuY2VPdmVycmlkZUNvbnRleHQoaXRlbVNjb3BlLm92ZXJyaWRlQ29udGV4dCk7XG4gICAgICBmaXJzdFZpZXcubm9kZXMuaW5zZXJ0QmVmb3JlKHRoaXMuZG9tLmJvdHRvbSk7XG4gICAgICAvLyB0b2RvOiBtYXliZSBzdGF0ZSB1cGZyb250IHRoYXQgYXN5bmMgbGlmZWN5Y2xlIGFyZW4ndCBzdXBwb3J0ZWQgd2l0aCB2aXJ0dWFsLXJlcGVhdFxuICAgICAgdm9pZCBmaXJzdFZpZXcuYWN0aXZhdGUoZmlyc3RWaWV3LCByZXBlYXRDb250cm9sbGVyLCBpdGVtU2NvcGUpO1xuICAgIH1cblxuICAgIHJldHVybiBmaXJzdFZpZXc7XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwcml2YXRlIGdldE9yQ3JlYXRlRmlyc3RWaWV3KCk6IElTeW50aGV0aWNWaWV3IHtcbiAgICBjb25zdCB2aWV3cyA9IHRoaXMudmlld3M7XG4gICAgaWYgKHZpZXdzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiB2aWV3c1swXTtcbiAgICB9XG4gICAgY29uc3QgdmlldyA9IHRoaXMuX2ZhY3RvcnkuY3JlYXRlKCk7XG4gICAgdmlld3MucHVzaCh2aWV3KTtcbiAgICByZXR1cm4gdmlldztcbiAgfVxufVxuXG5jbGFzcyBDb2xsZWN0aW9uT2JzZXJ2YXRpb25NZWRpYXRvciB7XG4gIC8qKiBAaW50ZXJuYWwgKi8gcHJpdmF0ZSBfY29sbGVjdGlvbiE6IENvbGxlY3Rpb247XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyByZXBlYXQ6IFZpcnR1YWxSZXBlYXQsXG4gICAgcHVibGljIGhhbmRsZUNvbGxlY3Rpb25DaGFuZ2U6IChjb2w6IENvbGxlY3Rpb24sIGluZGV4TWFwOiBJbmRleE1hcCkgPT4gdm9pZCxcbiAgKSB7IH1cblxuICBwdWJsaWMgc3RhcnQoYz86IENvbGxlY3Rpb24gfCBudWxsKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuX2NvbGxlY3Rpb24gPT09IGMpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zdG9wKCk7XG4gICAgaWYgKGMgIT0gbnVsbCkge1xuICAgICAgZ2V0Q29sbGVjdGlvbk9ic2VydmVyKHRoaXMuX2NvbGxlY3Rpb24gPSBjKT8uc3Vic2NyaWJlKHRoaXMpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBzdG9wKCk6IHZvaWQge1xuICAgIGdldENvbGxlY3Rpb25PYnNlcnZlcih0aGlzLl9jb2xsZWN0aW9uKT8udW5zdWJzY3JpYmUodGhpcyk7XG4gIH1cbn1cblxuaW50ZXJmYWNlIElCdWZmZXJDYWxjdWxhdGlvbiB7XG4gIGZpcnN0SW5kZXg6IG51bWJlcjtcbiAgdG9wQ291bnQ6IG51bWJlcjtcbiAgYm90Q291bnQ6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIElSZXBlYXRlckl0ZW1TY29wZSBleHRlbmRzIFNjb3BlIHtcbiAgcmVhZG9ubHkgb3ZlcnJpZGVDb250ZXh0OiBJUmVwZWF0T3ZlcnJpZGVDb250ZXh0O1xufVxuXG5pbnRlcmZhY2UgSVJlcGVhdE92ZXJyaWRlQ29udGV4dCBleHRlbmRzIElPdmVycmlkZUNvbnRleHQge1xuICAkaW5kZXg6IG51bWJlcjtcbiAgJGxlbmd0aDogbnVtYmVyO1xuICByZWFkb25seSAkZXZlbjogbnVtYmVyO1xuICByZWFkb25seSAkb2RkOiBudW1iZXI7XG4gIHJlYWRvbmx5ICRmaXJzdDogYm9vbGVhbjtcbiAgcmVhZG9ubHkgJGxhc3Q6IGJvb2xlYW47XG4gIHJlYWRvbmx5ICRtaWRkbGU6IGJvb2xlYW47XG59XG5cbmNvbnN0IGVuaGFuY2VkQ29udGV4dENhY2hlZCA9IG5ldyBXZWFrU2V0PElSZXBlYXRPdmVycmlkZUNvbnRleHQ+KCk7XG5mdW5jdGlvbiBlbmhhbmNlT3ZlcnJpZGVDb250ZXh0KGNvbnRleHQ6IElPdmVycmlkZUNvbnRleHQpIHtcbiAgY29uc3QgY3R4ID0gY29udGV4dCBhcyB1bmtub3duIGFzIElSZXBlYXRPdmVycmlkZUNvbnRleHQ7XG4gIGlmIChlbmhhbmNlZENvbnRleHRDYWNoZWQuaGFzKGN0eCkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMoY3R4LCB7XG4gICAgJGZpcnN0OiBjcmVhdGVHZXR0ZXJEZXNjcmlwdG9yKCRmaXJzdCksXG4gICAgJGxhc3Q6IGNyZWF0ZUdldHRlckRlc2NyaXB0b3IoJGxhc3QpLFxuICAgICRtaWRkbGU6IGNyZWF0ZUdldHRlckRlc2NyaXB0b3IoJG1pZGRsZSksXG4gICAgJGV2ZW46IGNyZWF0ZUdldHRlckRlc2NyaXB0b3IoJGV2ZW4pLFxuICAgICRvZGQ6IGNyZWF0ZUdldHRlckRlc2NyaXB0b3IoJG9kZCksXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVHZXR0ZXJEZXNjcmlwdG9yKGdldHRlcjogKCkgPT4gdW5rbm93bik6IFByb3BlcnR5RGVzY3JpcHRvciB7XG4gIHJldHVybiB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogdHJ1ZSwgZ2V0OiBnZXR0ZXIgfTtcbn1cblxuZnVuY3Rpb24gJGV2ZW4odGhpczogSVJlcGVhdE92ZXJyaWRlQ29udGV4dCkge1xuICByZXR1cm4gdGhpcy4kaW5kZXggJSAyID09PSAwO1xufVxuXG5mdW5jdGlvbiAkb2RkKHRoaXM6IElSZXBlYXRPdmVycmlkZUNvbnRleHQpIHtcbiAgcmV0dXJuIHRoaXMuJGluZGV4ICUgMiAhPT0gMDtcbn1cblxuZnVuY3Rpb24gJGZpcnN0KHRoaXM6IElSZXBlYXRPdmVycmlkZUNvbnRleHQpIHtcbiAgcmV0dXJuIHRoaXMuJGluZGV4ID09PSAwO1xufVxuXG5mdW5jdGlvbiAkbGFzdCh0aGlzOiBJUmVwZWF0T3ZlcnJpZGVDb250ZXh0KSB7XG4gIHJldHVybiB0aGlzLiRpbmRleCA9PT0gdGhpcy4kbGVuZ3RoIC0gMTtcbn1cblxuZnVuY3Rpb24gJG1pZGRsZSh0aGlzOiBJUmVwZWF0T3ZlcnJpZGVDb250ZXh0KSB7XG4gIHJldHVybiB0aGlzLiRpbmRleCA+IDAgJiYgdGhpcy4kaW5kZXggPCAodGhpcy4kbGVuZ3RoIC0gMSk7XG59XG5cbi8vIGZ1bmN0aW9uICRpc1Njcm9sbGluZyhwcmV2U2Nyb2xsZXJJbmZvOiBJU2Nyb2xsZXJJbmZvLCBuZXh0U2Nyb2xsZXJJbmZvOiBJU2Nyb2xsZXJJbmZvKTogYm9vbGVhbiB7XG4vLyAgIHJldHVybiBwcmV2U2Nyb2xsZXJJbmZvLnNjcm9sbFRvcCAhPT0gbmV4dFNjcm9sbGVySW5mby5zY3JvbGxUb3A7XG4vLyB9XG4iLCJpbXBvcnQgeyBJQ29udGFpbmVyLCBSZWdpc3RyYXRpb24gfSBmcm9tIFwiQGF1cmVsaWEva2VybmVsXCI7XG5pbXBvcnQgeyBJQ29sbGVjdGlvblN0cmF0ZWd5LCBJQ29sbGVjdGlvblN0cmF0ZWd5TG9jYXRvciB9IGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IGNyZWF0ZU1hcHBlZEVycm9yLCBFcnJvck5hbWVzIH0gZnJvbSAnLi9lcnJvcnMnO1xuXG5leHBvcnQgY2xhc3MgQ29sbGVjdGlvblN0cmF0ZWd5TG9jYXRvciBpbXBsZW1lbnRzIElDb2xsZWN0aW9uU3RyYXRlZ3lMb2NhdG9yIHtcbiAgcHVibGljIHN0YXRpYyByZWdpc3Rlcihjb250YWluZXI6IElDb250YWluZXIpIHtcbiAgICByZXR1cm4gUmVnaXN0cmF0aW9uLnNpbmdsZXRvbihJQ29sbGVjdGlvblN0cmF0ZWd5TG9jYXRvciwgdGhpcykucmVnaXN0ZXIoY29udGFpbmVyKTtcbiAgfVxuXG4gIHB1YmxpYyBnZXRTdHJhdGVneShpdGVtczogdW5rbm93bik6IElDb2xsZWN0aW9uU3RyYXRlZ3kge1xuICAgIGlmIChpdGVtcyA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gbmV3IE51bGxDb2xsZWN0aW9uU3RyYXRlZ3koKTtcbiAgICB9XG4gICAgaWYgKGl0ZW1zIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgIHJldHVybiBuZXcgQXJyYXlDb2xsZWN0aW9uU3RyYXRlZ3koaXRlbXMgYXMgdW5rbm93bltdKTtcbiAgICB9XG4gICAgdGhyb3cgY3JlYXRlTWFwcGVkRXJyb3IoRXJyb3JOYW1lcy51bnN1cHBvcnRlZF9jb2xsZWN0aW9uX3N0cmF0ZWd5LCB0eXBlb2YgaXRlbXMpO1xuICB9XG59XG5cbmNsYXNzIEFycmF5Q29sbGVjdGlvblN0cmF0ZWd5IGltcGxlbWVudHMgSUNvbGxlY3Rpb25TdHJhdGVneTx1bmtub3duW10+IHtcbiAgcHVibGljIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyByZWFkb25seSB2YWw6IHVua25vd25bXSxcbiAgKSB7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGNvdW50KCkge1xuICAgIHJldHVybiB0aGlzLnZhbC5sZW5ndGg7XG4gIH1cblxuICBwdWJsaWMgZmlyc3QoKTogdW5rbm93biB7XG4gICAgcmV0dXJuIHRoaXMuY291bnQgPiAwID8gdGhpcy52YWxbMF0gOiBudWxsO1xuICB9XG5cbiAgcHVibGljIGxhc3QoKTogdW5rbm93biB7XG4gICAgcmV0dXJuIHRoaXMuY291bnQgPiAwID8gdGhpcy52YWxbdGhpcy5jb3VudCAtIDFdIDogbnVsbDtcbiAgfVxuXG4gIHB1YmxpYyBpdGVtKGluZGV4OiBudW1iZXIpOiB1bmtub3duIHtcbiAgICByZXR1cm4gdGhpcy52YWxbaW5kZXhdID8/IG51bGw7XG4gIH1cblxuICBwdWJsaWMgcmFuZ2Uoc3RhcnQ6IG51bWJlciwgZW5kOiBudW1iZXIpOiB1bmtub3duW10ge1xuICAgIGNvbnN0IHZhbCA9IHRoaXMudmFsO1xuICAgIGNvbnN0IGxlbiA9IHRoaXMuY291bnQ7XG4gICAgaWYgKGxlbiA+IHN0YXJ0ICYmIGVuZCA+IHN0YXJ0KSB7XG4gICAgICByZXR1cm4gdmFsLnNsaWNlKHN0YXJ0LCBlbmQpO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH1cblxuICBwdWJsaWMgaXNOZWFyVG9wKGluZGV4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgICAvLyB0b2RvOiA1IGZyb20gY29uZmlndXJhdGlvblxuICAgIHJldHVybiBpbmRleCA8IDU7XG4gIH1cblxuICBwdWJsaWMgaXNOZWFyQm90dG9tKGluZGV4OiBudW1iZXIpOiBib29sZWFuIHtcbiAgICAvLyB0b2RvOiA1IGZyb20gY29uZmlndXJhdGlvblxuICAgIHJldHVybiBpbmRleCA+IHRoaXMudmFsLmxlbmd0aCAtIDU7XG4gIH1cbn1cblxuY2xhc3MgTnVsbENvbGxlY3Rpb25TdHJhdGVneSBpbXBsZW1lbnRzIElDb2xsZWN0aW9uU3RyYXRlZ3kge1xuXG4gIHB1YmxpYyB2YWwgPSBudWxsO1xuICBwdWJsaWMgY291bnQgPSAwO1xuXG4gIHB1YmxpYyBpc05lYXJUb3AoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcHVibGljIGlzTmVhckJvdHRvbSgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwdWJsaWMgZmlyc3QoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwdWJsaWMgbGFzdCgpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHB1YmxpYyBpdGVtKCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcHVibGljIHJhbmdlKCk6IHVua25vd25bXSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG4iLCJpbXBvcnQgeyBJUGxhdGZvcm0sIElSZW5kZXJMb2NhdGlvbiB9IGZyb20gJ0BhdXJlbGlhL3J1bnRpbWUtaHRtbCc7XG5pbXBvcnQgeyBJQ29udGFpbmVyLCBSZWdpc3RyYXRpb24gfSBmcm9tICdAYXVyZWxpYS9rZXJuZWwnO1xuaW1wb3J0IHsgSVZpcnR1YWxSZXBlYXREb20sIElEb21SZW5kZXJlciB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBnZXRTY3JvbGxlckVsZW1lbnQgfSBmcm9tICcuL3V0aWxpdGllcy1kb20nO1xuaW1wb3J0IHsgY3JlYXRlTWFwcGVkRXJyb3IsIEVycm9yTmFtZXMgfSBmcm9tICcuL2Vycm9ycyc7XG5cbmV4cG9ydCBjbGFzcyBEZWZhdWx0RG9tUmVuZGVyZXIgaW1wbGVtZW50cyBJRG9tUmVuZGVyZXIge1xuICAvKiogQGludGVybmFsICovXG4gIHByb3RlY3RlZCBzdGF0aWMgZ2V0IGluamVjdCgpIHsgcmV0dXJuIFtJUGxhdGZvcm1dOyB9XG5cbiAgcHVibGljIHN0YXRpYyByZWdpc3Rlcihjb250YWluZXI6IElDb250YWluZXIpIHtcbiAgICByZXR1cm4gUmVnaXN0cmF0aW9uLnNpbmdsZXRvbihJRG9tUmVuZGVyZXIsIHRoaXMpLnJlZ2lzdGVyKGNvbnRhaW5lcik7XG4gIH1cblxuICBwdWJsaWMgY29uc3RydWN0b3IoXG4gICAgcHJvdGVjdGVkIHA6IElQbGF0Zm9ybSxcbiAgKSB7IH1cblxuICBwdWJsaWMgcmVuZGVyKHRhcmdldDogSFRNTEVsZW1lbnQgfCBJUmVuZGVyTG9jYXRpb24sIGxheW91dDogJ3ZlcnRpY2FsJyB8ICdob3Jpem9udGFsJyA9ICd2ZXJ0aWNhbCcpOiBJVmlydHVhbFJlcGVhdERvbSB7XG4gICAgY29uc3QgZG9jID0gdGhpcy5wLmRvY3VtZW50O1xuICAgIGNvbnN0IHBhcmVudCA9IHRhcmdldC5wYXJlbnROb2RlIGFzIEVsZW1lbnQ7XG4gICAgLy8gVG9kbzogc2hvdWxkIHRoaXMgZXZlciBoYXBwZW4/XG4gICAgaWYgKHBhcmVudCA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgY3JlYXRlTWFwcGVkRXJyb3IoRXJyb3JOYW1lcy5pbnZhbGlkX3JlbmRlcl90YXJnZXQpO1xuICAgIH1cbiAgICBsZXQgYnVmZmVyRWxzOiBbSFRNTEVsZW1lbnQsIEhUTUxFbGVtZW50XTtcbiAgICBzd2l0Y2ggKHBhcmVudC50YWdOYW1lKSB7XG4gICAgICBjYXNlICdUQk9EWSc6XG4gICAgICBjYXNlICdUSEVBRCc6XG4gICAgICBjYXNlICdURk9PVCc6XG4gICAgICBjYXNlICdUQUJMRSc6XG4gICAgICAgIGJ1ZmZlckVscyA9IGluc2VydEJlZm9yZShkb2MsICd0cicsIHRhcmdldCk7XG4gICAgICAgIHJldHVybiBuZXcgVGFibGVEb20ocGFyZW50LmNsb3Nlc3QoJ3RhYmxlJykhLCB0YXJnZXQsIGJ1ZmZlckVsc1swXSwgYnVmZmVyRWxzWzFdLCBsYXlvdXQpO1xuICAgICAgY2FzZSAnVUwnOlxuICAgICAgY2FzZSAnT0wnOlxuICAgICAgICAvLyBsZXNzIGNoYW5jZSBvZiBkaXN0dXJiaW5nIENTUyBvZiBVTC9PTFxuICAgICAgICBidWZmZXJFbHMgPSBpbnNlcnRCZWZvcmUoZG9jLCAnZGl2JywgdGFyZ2V0KTtcbiAgICAgICAgcmV0dXJuIG5ldyBMaXN0RG9tKHBhcmVudCBhcyBIVE1MT0xpc3RFbGVtZW50LCB0YXJnZXQsIGJ1ZmZlckVsc1swXSwgYnVmZmVyRWxzWzFdLCBsYXlvdXQpO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgYnVmZmVyRWxzID0gaW5zZXJ0QmVmb3JlKGRvYywgJ2RpdicsIHRhcmdldCk7XG4gICAgICAgIHJldHVybiBuZXcgRGVmYXVsdERvbSh0YXJnZXQsIGJ1ZmZlckVsc1swXSwgYnVmZmVyRWxzWzFdLCBsYXlvdXQpO1xuICAgIH1cbiAgfVxufVxuXG5jbGFzcyBEZWZhdWx0RG9tIGltcGxlbWVudHMgSVZpcnR1YWxSZXBlYXREb20ge1xuICBwdWJsaWMgdEg6IG51bWJlciA9IDA7XG4gIHB1YmxpYyBiSDogbnVtYmVyID0gMDtcbiAgcHVibGljIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyByZWFkb25seSBhbmNob3I6IEhUTUxFbGVtZW50IHwgSVJlbmRlckxvY2F0aW9uLFxuICAgIHB1YmxpYyByZWFkb25seSB0b3A6IEhUTUxFbGVtZW50LFxuICAgIHB1YmxpYyByZWFkb25seSBib3R0b206IEhUTUxFbGVtZW50LFxuICAgIHB1YmxpYyByZWFkb25seSBsYXlvdXQ6ICd2ZXJ0aWNhbCcgfCAnaG9yaXpvbnRhbCcsXG4gICkgeyB9XG5cbiAgcHVibGljIGdldCBzY3JvbGxlcigpOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIGdldFNjcm9sbGVyRWxlbWVudCh0aGlzLmFuY2hvciwgdGhpcy5sYXlvdXQpO1xuICB9XG5cbiAgcHVibGljIGdldCBkaXN0YW5jZXMoKTogW251bWJlciwgbnVtYmVyXSB7XG4gICAgcmV0dXJuIFt0aGlzLnRILCB0aGlzLmJIXTtcbiAgfVxuXG4gIHB1YmxpYyB1cGRhdGUodG9wOiBudW1iZXIsIGJvdDogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMubGF5b3V0ID09PSAnaG9yaXpvbnRhbCcpIHtcbiAgICAgIHRoaXMudG9wLnN0eWxlLndpZHRoID0gYCR7dGhpcy50SCA9IHRvcH1weGA7XG4gICAgICB0aGlzLmJvdHRvbS5zdHlsZS53aWR0aCA9IGAke3RoaXMuYkggPSBib3R9cHhgO1xuICAgICAgLy8gUmVzZXQgaGVpZ2h0IGFuZCBzZXQgZGlzcGxheSB0byBpbmxpbmUtYmxvY2sgZm9yIGhvcml6b250YWwgbGF5b3V0XG4gICAgICB0aGlzLnRvcC5zdHlsZS5oZWlnaHQgPSAnMTAwJSc7XG4gICAgICB0aGlzLmJvdHRvbS5zdHlsZS5oZWlnaHQgPSAnMTAwJSc7XG4gICAgICB0aGlzLnRvcC5zdHlsZS5kaXNwbGF5ID0gJ2lubGluZS1ibG9jayc7XG4gICAgICB0aGlzLmJvdHRvbS5zdHlsZS5kaXNwbGF5ID0gJ2lubGluZS1ibG9jayc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudG9wLnN0eWxlLmhlaWdodCA9IGAke3RoaXMudEggPSB0b3B9cHhgO1xuICAgICAgdGhpcy5ib3R0b20uc3R5bGUuaGVpZ2h0ID0gYCR7dGhpcy5iSCA9IGJvdH1weGA7XG4gICAgICAvLyBSZXNldCB3aWR0aCBmb3IgdmVydGljYWwgbGF5b3V0XG4gICAgICB0aGlzLnRvcC5zdHlsZS53aWR0aCA9ICcnO1xuICAgICAgdGhpcy5ib3R0b20uc3R5bGUud2lkdGggPSAnJztcbiAgICAgIHRoaXMudG9wLnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgICAgIHRoaXMuYm90dG9tLnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgZGlzcG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLnRvcC5yZW1vdmUoKTtcbiAgICB0aGlzLmJvdHRvbS5yZW1vdmUoKTtcbiAgfVxufVxuXG5jbGFzcyBMaXN0RG9tIGV4dGVuZHMgRGVmYXVsdERvbSB7XG4gIHB1YmxpYyBjb25zdHJ1Y3RvcihcbiAgICBwdWJsaWMgcmVhZG9ubHkgbGlzdDogSFRNTFVMaXN0RWxlbWVudCB8IEhUTUxPTGlzdEVsZW1lbnQsXG4gICAgYW5jaG9yOiBIVE1MRWxlbWVudCB8IElSZW5kZXJMb2NhdGlvbixcbiAgICB0b3A6IEhUTUxFbGVtZW50LFxuICAgIGJvdHRvbTogSFRNTEVsZW1lbnQsXG4gICAgbGF5b3V0OiAndmVydGljYWwnIHwgJ2hvcml6b250YWwnLFxuICApIHtcbiAgICBzdXBlcihhbmNob3IsIHRvcCwgYm90dG9tLCBsYXlvdXQpO1xuICB9XG5cbiAgcHVibGljIGdldCBzY3JvbGxlcigpOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIGdldFNjcm9sbGVyRWxlbWVudCh0aGlzLmxpc3QsIHRoaXMubGF5b3V0KTtcbiAgfVxufVxuXG5jbGFzcyBUYWJsZURvbSBleHRlbmRzIERlZmF1bHREb20ge1xuICBwdWJsaWMgY29uc3RydWN0b3IoXG4gICAgcHVibGljIHJlYWRvbmx5IHRhYmxlOiBIVE1MVGFibGVFbGVtZW50LFxuICAgIGFuY2hvcjogSFRNTEVsZW1lbnQgfCBJUmVuZGVyTG9jYXRpb24sXG4gICAgdG9wOiBIVE1MRWxlbWVudCxcbiAgICBib3R0b206IEhUTUxFbGVtZW50LFxuICAgIGxheW91dDogJ3ZlcnRpY2FsJyB8ICdob3Jpem9udGFsJyxcbiAgKSB7XG4gICAgc3VwZXIoYW5jaG9yLCB0b3AsIGJvdHRvbSwgbGF5b3V0KTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgc2Nyb2xsZXIoKTogSFRNTEVsZW1lbnQge1xuICAgIHJldHVybiBnZXRTY3JvbGxlckVsZW1lbnQodGhpcy50YWJsZSwgdGhpcy5sYXlvdXQpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGluc2VydEJlZm9yZShkb2M6IERvY3VtZW50LCBlbDogc3RyaW5nLCB0YXJnZXQ6IEhUTUxFbGVtZW50IHwgSVJlbmRlckxvY2F0aW9uKTogW0hUTUxFbGVtZW50LCBIVE1MRWxlbWVudF0ge1xuICBjb25zdCBwYXJlbnQgPSB0YXJnZXQucGFyZW50Tm9kZSE7XG4gIHJldHVybiBbXG4gICAgcGFyZW50Lmluc2VydEJlZm9yZShkb2MuY3JlYXRlRWxlbWVudChlbCksIHRhcmdldCksXG4gICAgcGFyZW50Lmluc2VydEJlZm9yZShkb2MuY3JlYXRlRWxlbWVudChlbCksIHRhcmdldCksXG4gIF07XG59XG4iLCJpbXBvcnQgeyBJQ29udGFpbmVyLCBJUmVnaXN0cnkgfSBmcm9tICdAYXVyZWxpYS9rZXJuZWwnO1xuXG5pbXBvcnQgeyBWaXJ0dWFsUmVwZWF0IH0gZnJvbSAnLi92aXJ0dWFsLXJlcGVhdCc7XG5pbXBvcnQgeyBDb2xsZWN0aW9uU3RyYXRlZ3lMb2NhdG9yIH0gZnJvbSAnLi9jb2xsZWN0aW9uLXN0cmF0ZWd5JztcbmltcG9ydCB7IERlZmF1bHREb21SZW5kZXJlciB9IGZyb20gJy4vdmlydHVhbC1yZXBlYXQtZG9tLXJlbmRlcmVyJztcblxuZXhwb3J0IGNvbnN0IERlZmF1bHRWaXJ0dWFsaXphdGlvbkNvbmZpZ3VyYXRpb246IElSZWdpc3RyeSA9IHtcbiAgcmVnaXN0ZXIoY29udGFpbmVyOiBJQ29udGFpbmVyKTogSUNvbnRhaW5lciB7XG4gICAgcmV0dXJuIGNvbnRhaW5lci5yZWdpc3RlcihcbiAgICAgIENvbGxlY3Rpb25TdHJhdGVneUxvY2F0b3IsXG4gICAgICBEZWZhdWx0RG9tUmVuZGVyZXIsXG4gICAgICBWaXJ0dWFsUmVwZWF0LFxuICAgICk7XG4gIH1cbn07XG4iXSwibmFtZXMiOlsiRXJyb3JOYW1lcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBb0JhLE1BQUEsWUFBQSxtQkFBK0IsRUFBQSxDQUFBLGVBQUEsQ0FBOEIsY0FBYztBQWtCM0UsTUFBQSwwQkFB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
