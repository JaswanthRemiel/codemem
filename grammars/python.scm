; A function directly inside a class becomes a method in the parser.
(function_definition name: (identifier) @name body: (block) @body) @def.function
(class_definition name: (identifier) @name body: (block) @body) @def.class

; top-level constants
(module (expression_statement (assignment left: (identifier) @name)) @def.constant)

; calls
(call function: (identifier) @callee) @call
(call function: (attribute object: (_) @recv attribute: (identifier) @callee)) @call

; imports
(import_statement name: (dotted_name) @source) @import
(import_statement name: (aliased_import name: (dotted_name) @source)) @import
(import_from_statement module_name: (_) @source) @import
(import_from_statement name: (dotted_name) @iname) @import
(import_from_statement name: (aliased_import name: (dotted_name) @iname)) @import
