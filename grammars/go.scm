; Earlier patterns win when two match the same name.

(function_declaration name: (identifier) @name body: (block) @body) @def.function
(method_declaration
  receiver: (parameter_list (parameter_declaration type: [
    (type_identifier) @receiver
    (pointer_type (type_identifier) @receiver)
    (generic_type type: (type_identifier) @receiver)
    (pointer_type (generic_type type: (type_identifier) @receiver))]))
  name: (field_identifier) @name body: (block) @body) @def.method

; a type declared on its own: the symbol covers the whole declaration
(type_declaration . (type_spec name: (type_identifier) @name type: (struct_type (field_declaration_list) @body)) .) @def.class
(type_declaration . (type_spec name: (type_identifier) @name type: (interface_type) @body) .) @def.interface
(type_declaration . (type_spec name: (type_identifier) @name) .) @def.type
(type_declaration . (type_alias name: (type_identifier) @name) .) @def.type

; types inside a grouped `type ( ... )` block: one symbol per spec
(type_spec name: (type_identifier) @name type: (struct_type (field_declaration_list) @body)) @def.class
(type_spec name: (type_identifier) @name type: (interface_type) @body) @def.interface
(type_spec name: (type_identifier) @name) @def.type
(type_alias name: (type_identifier) @name) @def.type

; top-level constants and variables
(source_file (const_declaration (const_spec name: (identifier) @name) @def.constant))
(source_file (var_declaration (var_spec name: (identifier) @name) @def.constant))

; calls
(call_expression function: (identifier) @callee) @call
(call_expression function: (selector_expression operand: (_) @recv field: (field_identifier) @callee)) @call

; imports
(import_spec path: (interpreted_string_literal (interpreted_string_literal_content) @source)) @import
