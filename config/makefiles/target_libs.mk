# -*- makefile -*-
# vim:set ts=8 sw=8 sts=8 noet:
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

ifdef EXPORT_LIBRARY
ifeq ($(EXPORT_LIBRARY),1)
ifdef IS_COMPONENT
EXPORT_LIBRARY = $(DEPTH)/staticlib/components
else
EXPORT_LIBRARY = $(DEPTH)/staticlib
endif
else
# If EXPORT_LIBRARY has a value, we'll be installing there. We also need to cleanup there
GARBAGE += $(foreach lib,$(LIBRARY),$(EXPORT_LIBRARY)/$(lib))
endif
endif # EXPORT_LIBRARY

binaries libs:: $(SUBMAKEFILES) $(TARGETS)
ifndef NO_DIST_INSTALL
ifdef SHARED_LIBRARY
ifdef IS_COMPONENT
	$(INSTALL) $(IFLAGS2) $(SHARED_LIBRARY) $(FINAL_TARGET)/components
	$(ELF_DYNSTR_GC) $(FINAL_TARGET)/components/$(SHARED_LIBRARY)
ifndef NO_COMPONENTS_MANIFEST
	@$(PYTHON) $(MOZILLA_DIR)/config/buildlist.py $(FINAL_TARGET)/chrome.manifest "manifest components/components.manifest"
	@$(PYTHON) $(MOZILLA_DIR)/config/buildlist.py $(FINAL_TARGET)/components/components.manifest "binary-component $(SHARED_LIBRARY)"
endif
endif # IS_COMPONENT
endif # SHARED_LIBRARY
endif # !NO_DIST_INSTALL

ifndef NO_DIST_INSTALL

ifneq (,$(strip $(PROGRAM)$(SIMPLE_PROGRAMS)))
PROGRAMS_EXECUTABLES = $(SIMPLE_PROGRAMS) $(PROGRAM)
PROGRAMS_DEST ?= $(FINAL_TARGET)
PROGRAMS_TARGET := binaries libs
INSTALL_TARGETS += PROGRAMS
endif

ifdef LIBRARY
ifdef EXPORT_LIBRARY
LIBRARY_FILES = $(LIBRARY)
LIBRARY_DEST ?= $(EXPORT_LIBRARY)
LIBRARY_TARGET = binaries libs
INSTALL_TARGETS += LIBRARY
endif
ifdef DIST_INSTALL
ifdef IS_COMPONENT
$(error Shipping static component libs makes no sense.)
else
DIST_LIBRARY_FILES = $(LIBRARY)
DIST_LIBRARY_DEST ?= $(DIST)/lib
DIST_LIBRARY_TARGET = binaries libs
INSTALL_TARGETS += DIST_LIBRARY
endif
endif # DIST_INSTALL
endif # LIBRARY


ifdef SHARED_LIBRARY
ifndef IS_COMPONENT
SHARED_LIBRARY_FILES = $(SHARED_LIBRARY)
SHARED_LIBRARY_DEST ?= $(FINAL_TARGET)
SHARED_LIBRARY_TARGET = binaries libs
INSTALL_TARGETS += SHARED_LIBRARY

ifneq (,$(filter OS2 WINNT,$(OS_ARCH)))
ifndef NO_INSTALL_IMPORT_LIBRARY
IMPORT_LIB_FILES = $(IMPORT_LIBRARY)
endif # NO_INSTALL_IMPORT_LIBRARY
else
IMPORT_LIB_FILES = $(SHARED_LIBRARY)
endif

IMPORT_LIB_DEST ?= $(DIST)/lib
IMPORT_LIB_TARGET = binaries libs
ifdef IMPORT_LIB_FILES
INSTALL_TARGETS += IMPORT_LIB
endif

endif # ! IS_COMPONENT
endif # SHARED_LIBRARY

ifneq (,$(strip $(HOST_SIMPLE_PROGRAMS)$(HOST_PROGRAM)))
HOST_PROGRAMS_EXECUTABLES = $(HOST_SIMPLE_PROGRAMS) $(HOST_PROGRAM)
HOST_PROGRAMS_DEST ?= $(DIST)/host/bin
HOST_PROGRAMS_TARGET = binaries libs
INSTALL_TARGETS += HOST_PROGRAMS
endif

ifdef HOST_LIBRARY
HOST_LIBRARY_FILES = $(HOST_LIBRARY)
HOST_LIBRARY_DEST ?= $(DIST)/host/lib
HOST_LIBRARY_TARGET = binaries libs
INSTALL_TARGETS += HOST_LIBRARY
endif

endif # !NO_DIST_INSTALL

ifdef MOZ_PSEUDO_DERECURSE
BINARIES_INSTALL_TARGETS := $(foreach category,$(INSTALL_TARGETS),$(if $(filter binaries,$($(category)_TARGET)),$(category)))

# Fill a dependency file with all the binaries installed somewhere in $(DIST)
# and with dependencies on the relevant backend files.
BINARIES_PP := $(MDDEPDIR)/binaries.pp

$(BINARIES_PP): Makefile $(wildcard backend.mk) $(call mkdir_deps,$(MDDEPDIR))
	@echo "$(strip $(foreach category,$(BINARIES_INSTALL_TARGETS),\
		$(foreach file,$($(category)_FILES) $($(category)_EXECUTABLES),\
			$($(category)_DEST)/$(notdir $(file)): $(file)%\
		)\
	))binaries: Makefile $(wildcard backend.mk)" | tr % '\n' > $@

else
binaries::
	$(error The binaries target is not supported without MOZ_PSEUDO_DERECURSE)
endif

# EOF
