; Shared by JavaScript, TypeScript, and TSX. Earlier patterns win when two match the same name.

; functions
(function_declaration name: (_) @name body: (_) @body) @def.function
(generator_function_declaration name: (_) @name body: (_) @body) @def.function
(lexical_declaration
  (variable_declarator name: (identifier) @name
    value: [(arrow_function body: (_) @body) (function_expression body: (_) @body)])) @def.function
(variable_declaration
  (variable_declarator name: (identifier) @name
    value: [(arrow_function body: (_) @body) (function_expression body: (_) @body)])) @def.function
(expression_statement
  (assignment_expression left: (member_expression property: (property_identifier) @name)
    right: [(arrow_function body: (_) @body) (function_expression body: (_) @body)])) @def.function

; classes and methods
(class_declaration name: (_) @name body: (_) @body) @def.class
(method_definition name: (_) @name body: (_) @body) @def.method

; top-level constants
(program (lexical_declaration (variable_declarator name: (identifier) @name)) @def.constant)
(program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name)) @def.constant))

; calls
(call_expression function: (identifier) @callee) @call
(call_expression function: (member_expression object: (_) @recv property: (property_identifier) @callee)) @call
(new_expression constructor: (identifier) @callee) @call

; imports: @source names the module; @idefault, @iname (+ @ialias), and @inamespace are bindings
(import_statement source: (string (string_fragment) @source)) @import
(import_statement (import_clause (identifier) @idefault)) @import
(import_statement (import_clause (named_imports (import_specifier name: (_) @iname alias: (_)? @ialias)))) @import
(import_statement (import_clause (namespace_import (identifier) @inamespace))) @import
; CommonJS: const x = require('./y') and const { a, b } = require('./y')
((variable_declarator name: (identifier) @inamespace
   value: (call_expression function: (identifier) @_require
     arguments: (arguments (string (string_fragment) @source)))) @import
  (#eq? @_require "require"))
((variable_declarator name: (object_pattern (shorthand_property_identifier_pattern) @iname)
   value: (call_expression function: (identifier) @_require
     arguments: (arguments (string (string_fragment) @source)))) @import
  (#eq? @_require "require"))
