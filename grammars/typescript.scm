; TypeScript and TSX only, appended to ecma.scm.

; overload signatures: merged into the implementation that follows them
(function_signature name: (_) @name) @def.overload
(class_body (method_signature name: (_) @name) @def.overload)
(class_body (abstract_method_signature name: (_) @name) @def.overload)

(abstract_class_declaration name: (_) @name body: (_) @body) @def.class
(public_field_definition name: (_) @name
  value: [(arrow_function body: (_) @body) (function_expression body: (_) @body)]) @def.method
(interface_declaration name: (_) @name body: (_) @body) @def.interface
(type_alias_declaration name: (_) @name) @def.type
(enum_declaration name: (_) @name body: (_) @body) @def.enum

; inheritance and referenced types. Earlier patterns win, so an implemented interface is
; not also counted as a plain type reference.
(class_heritage (extends_clause value: (identifier) @ref.extends))
(class_heritage (implements_clause (type_identifier) @ref.implements))
(extends_type_clause type: (type_identifier) @ref.extends)
(type_identifier) @ref.type
