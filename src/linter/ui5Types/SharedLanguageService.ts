import ts from "typescript";
import LanguageServiceHostProxy from "./LanguageServiceHostProxy.js";
import DocumentRegistryProxy from "./DocumentRegistryProxy.js";

export default class SharedLanguageService {
	private readonly languageServiceHostProxy: LanguageServiceHostProxy;
	private readonly documentRegistryProxy: DocumentRegistryProxy;
	private readonly languageService: ts.LanguageService;
	private acquired = false;
	private projectScriptVersion = 0;
	private lastTypesIdentity: string | undefined;

	constructor() {
		this.languageServiceHostProxy = new LanguageServiceHostProxy();
		this.documentRegistryProxy = new DocumentRegistryProxy();
		this.languageService = ts.createLanguageService(this.languageServiceHostProxy, this.documentRegistryProxy);
	}

	acquire(languageServiceHost: ts.LanguageServiceHost, typesIdentity?: string) {
		if (this.acquired) {
			throw new Error("SharedCompiler is already acquired");
		}
		this.acquired = true;

		// Clear shared type caches if the types source has changed (e.g. different @sapui5/types version)
		if (typesIdentity && typesIdentity !== this.lastTypesIdentity) {
			this.languageServiceHostProxy.clearSharedCache();
			this.lastTypesIdentity = typesIdentity;
		}

		// Set actual LanguageServiceHost implementation
		this.languageServiceHostProxy.setHost(languageServiceHost);
	}

	getProgram() {
		if (!this.acquired) {
			throw new Error("SharedCompiler is not acquired");
		}

		const program = this.languageService.getProgram();
		if (!program) {
			throw new Error("SharedCompiler failed to create a program");
		}
		return program;
	}

	release() {
		if (!this.acquired) {
			throw new Error("SharedCompiler is not acquired");
		}

		// Remove previously set LanguageServiceHost implementation
		this.languageServiceHostProxy.setHost(null);

		this.acquired = false;
	}

	getNextProjectScriptVersion() {
		this.projectScriptVersion++;
		return this.projectScriptVersion.toString();
	}
}
