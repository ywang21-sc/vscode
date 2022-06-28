/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import * as dom from 'vs/base/browser/dom';
import { getDomNodePagePosition } from 'vs/base/browser/dom';
import { IAnchor } from 'vs/base/browser/ui/contextview/contextview';
import { IListEvent, IListRenderer } from 'vs/base/browser/ui/list/list';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { canceled } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { ResolvedKeybinding } from 'vs/base/common/keybindings';
import { Lazy } from 'vs/base/common/lazy';
import { Disposable, dispose, MutableDisposable, IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { CodeAction, Command } from 'vs/editor/common/languages';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import { codeActionCommandId, CodeActionItem, CodeActionSet, fixAllCommandId, organizeImportsCommandId, refactorCommandId, sourceActionCommandId } from 'vs/editor/contrib/codeAction/browser/codeAction';
import { CodeActionModel } from 'vs/editor/contrib/codeAction/browser/codeActionModel';
import { CodeActionAutoApply, CodeActionCommandArgs, CodeActionKind, CodeActionTrigger, CodeActionTriggerSource } from 'vs/editor/contrib/codeAction/browser/types';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { attachListStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
// import { Emitter } from 'vs/base/common/event';

interface CodeActionWidgetDelegate {
	onSelectCodeAction: (action: CodeActionItem, trigger: CodeActionTrigger) => Promise<any>;
}

interface ResolveCodeActionKeybinding {
	readonly kind: CodeActionKind;
	readonly preferred: boolean;
	readonly resolvedKeybinding: ResolvedKeybinding;
}

class CodeActionAction extends Action {
	constructor(
		public readonly action: CodeAction,
		callback: () => Promise<void>,
	) {
		super(action.command ? action.command.id : action.title, stripNewlines(action.title), undefined, !action.disabled, callback);
	}
}

function stripNewlines(str: string): string {
	return str.replace(/\r\n|\r|\n/g, ' ');
}

export interface CodeActionShowOptions {
	readonly includeDisabledActions: boolean;
	readonly fromLightbulb?: boolean;
}
export interface ICodeActionMenuItem {
	title: string;
	detail?: string;
	decoratorRight?: string;
	isDisabled?: boolean;
}

export interface ICodeMenuOptions {
	useCustomDrawn?: boolean;
	ariaLabel?: string;
	ariaDescription?: string;
	minBottomMargin?: number;
	optionsAsChildren?: boolean;
}

export interface ICodeActionMenuTemplateData {
	root: HTMLElement;
	text: HTMLElement;
	detail: HTMLElement;
	decoratorRight: HTMLElement;
	disposables: IDisposable[];
}

// export interface ICodeMenuData {
// 	selected: string;
// 	index: number;
// }

const TEMPLATE_ID = 'test';
class CodeMenuRenderer implements IListRenderer<ICodeActionMenuItem, ICodeActionMenuTemplateData> {
	get templateId(): string { return TEMPLATE_ID; }

	renderTemplate(container: HTMLElement): ICodeActionMenuTemplateData {
		const data: ICodeActionMenuTemplateData = Object.create(null);
		data.disposables = [];
		data.root = container;
		data.text = document.createElement('span');
		container.append(data.text);

		// data.text = dom.append(container, $('.option-text'));
		// data.detail = dom.append(container, $('.option-detail'));
		// data.decoratorRight = dom.append(container, $('.option-decorator-right'));

		return data;
	}
	renderElement(element: ICodeActionMenuItem, index: number, templateData: ICodeActionMenuTemplateData): void {
		const data: ICodeActionMenuTemplateData = templateData;

		const text = element.title;

		const isDisabled = element.isDisabled;

		data.text.textContent = text;
		data.detail.textContent = '';
		data.decoratorRight.innerText = '';

		if (isDisabled) {
			data.root.classList.add('option-disabled');

		} else {
			data.root.classList.remove('option-disabled');
		}

	}
	disposeTemplate(templateData: ICodeActionMenuTemplateData): void {
		templateData.disposables = dispose(templateData.disposables);
	}

}


export class CodeActionWidget<T> extends List<T> {

}

interface ISelectedCodeAction {
	action: CodeAction;
	index: number;
	model: CodeActionModel;
}


export class CodeActionMenu extends Disposable {

	private codeActionList!: List<ICodeActionMenuItem>;
	private options: ICodeActionMenuItem[] = [];
	private _visible: boolean = false;
	private readonly _showingActions = this._register(new MutableDisposable<CodeActionSet>());
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSelect = new Emitter<ISelectedCodeAction>();
	private parent: HTMLElement;
	private listTrigger!: CodeActionTrigger;
	private selected!: CodeActionItem;
	// private showActions: CodeActionItem[];

	readonly onDidSelect: Event<ISelectedCodeAction> = this._onDidSelect.event;


	private readonly _keybindingResolver: CodeActionKeybindingResolver;
	listRenderer: any;
	// selected: any;
	// _isVisible: any;

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _delegate: CodeActionWidgetDelegate,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IThemeService _themeService: IThemeService,
	) {
		super();

		this._keybindingResolver = new CodeActionKeybindingResolver({
			getKeybindings: () => keybindingService.getKeybindings()
		});


		// this._onDidSelect = new Emitter<ICodeMenuData>();
		// this._register(this._onDidSelect);

		// this.registerListeners();


		// this.selected = 0;

		// const codeOption = <ICodeActionMenuItem>{ text: 'test', detail: 'test detail' };
		// const codeOption2 = <ICodeActionMenuItem>{ text: 'test2', detail: 'test2 detail' };
		// const codeOption3 = <ICodeActionMenuItem>{ text: 'test3', detail: 'test3 detail' };
		// const codeOption4 = <ICodeActionMenuItem>{ text: 'test4', detail: 'test4 detail' };
		// const codeOption5 = <ICodeActionMenuItem>{ text: 'test5', detail: 'test5 detail' };
		// const codeOption6 = <ICodeActionMenuItem>{ text: 'test6', detail: 'test6 detail' };
		// this.options = [codeOption, codeOption2, codeOption3, codeOption4, codeOption5, codeOption6];

		// if (this.options) {
		// 	this.setOptions(this.options, this.selected);
		// }

		if (this.codeActionList) {
			const temp = this.codeActionList.getSelection();
			console.log(temp);
		}



		this.parent = document.createElement('div');
		this.parent.style.backgroundColor = 'none';
		this.parent.style.border = '3px solid red';
		this.parent.style.width = '300px';
		this.parent.style.height = '500px';
		this.parent.id = 'testRedSquare';
		this.parent.style.position = 'absolute';
		this.parent.style.top = '0';
		this.listRenderer = new CodeMenuRenderer();

		this.codeActionList = new List('test', this.parent, {
			getHeight(element) {
				return 20;
			},
			getTemplateId(element) {
				return 'test';
			}
		}, [this.listRenderer],



			//new class, + new instance, id of rendere match id of getTemplateID
			//renderTemplate, renderElement
		);


		if (this.codeActionList) {
			this._disposables.add(this.codeActionList.onDidChangeSelection(e => this._onListSelection(e)));
		}


	}

	get isVisible(): boolean {
		return this._visible;
	}

	private _onListSelection(e: IListEvent<CodeAction>): void {
		if (e.elements.length) {
			const toCodeActionAction = (item: CodeActionItem): CodeActionAction => new CodeActionAction(item.action, () => this._delegate.onSelectCodeAction(item, this.listTrigger));
			// this._select(e.elements[0], e.indexes[0]);
		}
	}

	// private _select(action: CodeAction, index: number): void {
	// 	const completionModel = this._completionModel;
	// 	if (completionModel) {
	// 		this._onDidSelect.fire({ action, index, model: completionModel });
	// 		// this.editor.focus();
	// 	}
	// }


	private setCodeActionMenuList() {
		this.codeActionList?.splice(0, this.codeActionList.length, this.options);
	}

	private createOption(value: string, index: number, disabled?: boolean): HTMLOptionElement {
		const option = document.createElement('option');
		option.value = value;
		option.text = value;
		option.disabled = !!disabled;

		return option;
	}

	private createCodeActionMenuList(element: HTMLElement): void {
		// if (this.codeActionList) {
		// 	return;
		// }

		const codeOption = <ICodeActionMenuItem>{ title: 'Extract to function in global scope', detail: 'test detail' };
		const codeOption2 = <ICodeActionMenuItem>{ title: 'test2', detail: 'test2 detail' };
		const codeOption3 = <ICodeActionMenuItem>{ title: 'test3', detail: 'test3 detail' };
		const codeOption4 = <ICodeActionMenuItem>{ title: 'test4', detail: 'test4 detail' };
		const codeOption5 = <ICodeActionMenuItem>{ title: 'test5', detail: 'test5 detail' };
		const codeOption6 = <ICodeActionMenuItem>{ title: 'test6', detail: 'test6 detail' };
		this.options = [codeOption, codeOption2, codeOption3, codeOption4, codeOption5, codeOption6];

		// const paragraph = document.createTextNode('new paragraph and some more text');
		// divElement.appendChild(paragraph);
		// this.selectElement = document.createElement('select');
		// this.selectElement.add(this.createOption('testestestest', 0, false));
		// this.selectElement.add(this.createOption('test2', 0, false));
		// divElement.appendChild(this.selectElement);

		// const listContainer = document.createElement('div');
		// divElement.appendChild(listContainer);

		this._editor.getDomNode()?.append(this.parent);
	}


	public async show(trigger: CodeActionTrigger, codeActions: CodeActionSet, at: IAnchor | IPosition, options: CodeActionShowOptions): Promise<void> {
		const actionsToShow = options.includeDisabledActions ? codeActions.allActions : codeActions.validActions;
		if (!actionsToShow.length) {
			this._visible = false;
			return;
		}

		// this.showActions = actionsToShow;

		//Some helper that will make a call to this.getMenuActions()

		if (!this._editor.getDomNode()) {
			// cancel when editor went off-dom
			this._visible = false;
			throw canceled();
		}

		this._visible = true;
		this._showingActions.value = codeActions;


		this.listTrigger = trigger;
		this.createCodeActionMenuList(this.parent);
		this.setCodeActionMenuList();




		const menuActions = this.getMenuActions(trigger, actionsToShow, codeActions.documentation);

		const anchor = Position.isIPosition(at) ? this._toCoords(at) : at || { x: 0, y: 0 };
		const resolver = this._keybindingResolver.getResolver();

		const useShadowDOM = this._editor.getOption(EditorOption.useShadowDOM);

		this._contextMenuService.showContextMenu({
			domForShadowRoot: useShadowDOM ? this._editor.getDomNode()! : undefined,
			getAnchor: () => anchor,
			getActions: () => menuActions,
			onHide: (didCancel) => {
				const openedFromString = (options.fromLightbulb) ? CodeActionTriggerSource.Lightbulb : trigger.triggerAction;

				type ApplyCodeActionEvent = {
					codeActionFrom: CodeActionTriggerSource;
					validCodeActions: number;
					cancelled: boolean;
				};

				type ApplyCodeEventClassification = {
					codeActionFrom: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The kind of action used to opened the code action.' };
					validCodeActions: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The total number of valid actions that are highlighted and can be used.' };
					cancelled: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The indicator if the menu was selected or cancelled.' };
					owner: 'mjbvz';
					comment: 'Event used to gain insights into how code actions are being triggered';
				};

				this._telemetryService.publicLog2<ApplyCodeActionEvent, ApplyCodeEventClassification>('codeAction.applyCodeAction', {
					codeActionFrom: openedFromString,
					validCodeActions: codeActions.validActions.length,
					cancelled: didCancel,

				});

				this._visible = false;
				this._editor.focus();
			},
			autoSelectFirstItem: true,
			getKeyBinding: action => action instanceof CodeActionAction ? resolver(action.action) : undefined,
		});
	}

	private getMenuActions(
		trigger: CodeActionTrigger,
		actionsToShow: readonly CodeActionItem[],
		documentation: readonly Command[]
	): IAction[] {
		const toCodeActionAction = (item: CodeActionItem): CodeActionAction => new CodeActionAction(item.action, () => this._delegate.onSelectCodeAction(item, trigger));
		const result: IAction[] = actionsToShow
			.map(toCodeActionAction);

		const allDocumentation: Command[] = [...documentation];

		const model = this._editor.getModel();
		if (model && result.length) {
			for (const provider of this._languageFeaturesService.codeActionProvider.all(model)) {
				if (provider._getAdditionalMenuItems) {
					allDocumentation.push(...provider._getAdditionalMenuItems({ trigger: trigger.type, only: trigger.filter?.include?.value }, actionsToShow.map(item => item.action)));
				}
			}
		}

		if (allDocumentation.length) {
			result.push(new Separator(), ...allDocumentation.map(command => toCodeActionAction(new CodeActionItem({
				title: command.title,
				command: command,
			}, undefined))));
		}

		return result;
	}

	private _toCoords(position: IPosition): { x: number; y: number } {
		if (!this._editor.hasModel()) {
			return { x: 0, y: 0 };
		}
		this._editor.revealPosition(position, ScrollType.Immediate);
		this._editor.render();

		// Translate to absolute editor position
		const cursorCoords = this._editor.getScrolledVisiblePosition(position);
		const editorCoords = getDomNodePagePosition(this._editor.getDomNode());
		const x = editorCoords.left + cursorCoords.left;
		const y = editorCoords.top + cursorCoords.top + cursorCoords.height;

		return { x, y };
	}
}

export class CodeActionKeybindingResolver {
	private static readonly codeActionCommands: readonly string[] = [
		refactorCommandId,
		codeActionCommandId,
		sourceActionCommandId,
		organizeImportsCommandId,
		fixAllCommandId
	];

	constructor(
		private readonly _keybindingProvider: {
			getKeybindings(): readonly ResolvedKeybindingItem[];
		},
	) { }

	public getResolver(): (action: CodeAction) => ResolvedKeybinding | undefined {
		// Lazy since we may not actually ever read the value
		const allCodeActionBindings = new Lazy<readonly ResolveCodeActionKeybinding[]>(() =>
			this._keybindingProvider.getKeybindings()
				.filter(item => CodeActionKeybindingResolver.codeActionCommands.indexOf(item.command!) >= 0)
				.filter(item => item.resolvedKeybinding)
				.map((item): ResolveCodeActionKeybinding => {
					// Special case these commands since they come built-in with VS Code and don't use 'commandArgs'
					let commandArgs = item.commandArgs;
					if (item.command === organizeImportsCommandId) {
						commandArgs = { kind: CodeActionKind.SourceOrganizeImports.value };
					} else if (item.command === fixAllCommandId) {
						commandArgs = { kind: CodeActionKind.SourceFixAll.value };
					}

					return {
						resolvedKeybinding: item.resolvedKeybinding!,
						...CodeActionCommandArgs.fromUser(commandArgs, {
							kind: CodeActionKind.None,
							apply: CodeActionAutoApply.Never
						})
					};
				}));

		return (action) => {
			if (action.kind) {
				const binding = this.bestKeybindingForCodeAction(action, allCodeActionBindings.getValue());
				return binding?.resolvedKeybinding;
			}
			return undefined;
		};
	}

	private bestKeybindingForCodeAction(
		action: CodeAction,
		candidates: readonly ResolveCodeActionKeybinding[],
	): ResolveCodeActionKeybinding | undefined {
		if (!action.kind) {
			return undefined;
		}
		const kind = new CodeActionKind(action.kind);

		return candidates
			.filter(candidate => candidate.kind.contains(kind))
			.filter(candidate => {
				if (candidate.preferred) {
					// If the candidate keybinding only applies to preferred actions, the this action must also be preferred
					return action.isPreferred;
				}
				return true;
			})
			.reduceRight((currentBest, candidate) => {
				if (!currentBest) {
					return candidate;
				}
				// Select the more specific binding
				return currentBest.kind.contains(candidate.kind) ? candidate : currentBest;
			}, undefined as ResolveCodeActionKeybinding | undefined);
	}
}
